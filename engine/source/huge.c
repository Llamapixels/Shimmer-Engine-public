#include <stddef.h>
#include <stdint.h>

#include "huge.h"

/*
 * C port of hUGEDriver (see huge.h). Structure and names follow the
 * original assembly closely so the two can be compared side by side;
 * comments marked "GBA:" are where the hardware differs from the
 * Game Boy and the port does something different on purpose.
 *
 * GBA: the PSG registers are the Game Boy's NRxx registers, but at
 * different addresses and not all at a fixed 5-byte stride, so each
 * channel's registers are looked up from small tables instead of
 * computed the way the asm does.
 */

#define REG8(addr) (*(volatile uint8_t *)(addr))

#define NR10 REG8(0x04000060)
#define NR11 REG8(0x04000062)
#define NR12 REG8(0x04000063)
#define NR13 REG8(0x04000064)
#define NR14 REG8(0x04000065)
#define NR21 REG8(0x04000068)
#define NR22 REG8(0x04000069)
#define NR23 REG8(0x0400006C)
#define NR24 REG8(0x0400006D)
#define NR30 REG8(0x04000070)
#define NR31 REG8(0x04000072)
#define NR32 REG8(0x04000073)
#define NR33 REG8(0x04000074)
#define NR34 REG8(0x04000075)
#define NR41 REG8(0x04000078)
#define NR42 REG8(0x04000079)
#define NR43 REG8(0x0400007C)
#define NR44 REG8(0x0400007D)
#define NR50 REG8(0x04000080)
#define NR51 REG8(0x04000081)
#define WAVE_RAM ((volatile uint16_t *)0x04000090)

/* NRx2 (envelope; NR32 for the wave channel) and NRx4 per channel -
 * the two registers note_cut/vol_slide address by channel number. */
static volatile uint8_t *const reg_env[4] = {
    &NR12, &NR22, &NR32, &NR42,
};
static volatile uint8_t *const reg_go[4] = {
    &NR14, &NR24, &NR34, &NR44,
};

/* GBA: NR30 bit 6 picks which of the two 32-sample wave RAM banks
 * plays; the CPU reads/writes the *other* one. Wave data is always
 * written to bank 0 (with bank 1 selected) and played from bank 0. */
#define NR30_PLAY_BANK0  0x80
#define NR30_WRITE_BANK0 0x40

#define PATTERN_LENGTH 64
#define LAST_NOTE      72
#define NO_NOTE        90
#define NO_WAVE        100

/* hUGE_note_table.inc: NRx3/NRx4 period for each of the 72 notes
 * (C3..B8). GBA: the PSG runs at the same effective clock as the
 * Game Boy's, so the same periods give the same pitches. */
static const uint16_t note_table[LAST_NOTE] = {
      44,  156,  262,  363,  457,  547,  631,  710,  786,  854,  923,  986,
    1046, 1102, 1155, 1205, 1253, 1297, 1339, 1379, 1417, 1452, 1486, 1517,
    1546, 1575, 1602, 1627, 1650, 1673, 1694, 1714, 1732, 1750, 1767, 1783,
    1798, 1812, 1825, 1837, 1849, 1860, 1871, 1881, 1890, 1899, 1907, 1915,
    1923, 1930, 1936, 1943, 1949, 1954, 1959, 1964, 1969, 1974, 1978, 1982,
    1985, 1988, 1992, 1995, 1998, 2001, 2004, 2006, 2009, 2011, 2013, 2015,
};

typedef struct {
    uint16_t period;            /* CH4: its NR43 poly value */
    uint16_t toneporta_target;
    uint8_t note;
    uint8_t highmask;
    const uint8_t *table;
    uint8_t table_row;
} Channel;

static const HugeSong *song;
static uint8_t ticks_per_row;
static uint8_t current_wave;
static const uint8_t *pattern[4];

/* Zeroed by huge_init (the asm's start_zero..end_zero block). */
static uint8_t mute_channels;
static uint8_t counter;
static uint8_t tick;
static uint8_t row_break;
static uint8_t next_order;
static uint8_t row;
static uint8_t current_order;
static uint8_t step_width4;
static Channel channels[4];

/* Not in the asm: set when playback wraps from the last order back
 * to the first, so music.c can stop a song started with loop = 0. */
static uint8_t wrapped;

static void (*routine_callback)(uint8_t routine);

void huge_set_routine_callback(void (*callback)(uint8_t routine))
{
    routine_callback = callback;
}

static uint8_t swap8(uint8_t v)
{
    return (uint8_t)((v << 4) | (v >> 4));
}

static int is_muted(uint8_t ch)
{
    return (mute_channels >> ch) & 1;
}

static void load_patterns(uint8_t order)
{
    for (int ch = 0; ch < 4; ch++)
        pattern[ch] = song->orders[ch][order];
}

static uint16_t get_note_period(uint8_t note)
{
    /* The asm reads past the table for out-of-range notes (possible
     * via arpeggio/subpattern offsets); clamp instead. */
    if (note >= LAST_NOTE)
        note = LAST_NOTE - 1;
    return note_table[note];
}

/* Note ID -> NR43 polynomial counter (RichardULZ's formula, as in
 * the asm, including its 8-bit wraparound). */
static uint8_t get_note_poly(uint8_t note)
{
    uint8_t a = (uint8_t)~(uint8_t)(note + 192);
    if (a < 7)
        return a;
    uint8_t b = (uint8_t)((a >> 2) - 1);
    uint8_t c = (uint8_t)((a & 3) + 4);
    return c | swap8(b);
}

/* Update a channel's frequency without retriggering, unless `h` has
 * bit 7 set. For CH4 `value`'s low byte is a note ID, not a period. */
static void update_channel_freq(uint8_t ch, uint16_t value, uint8_t h)
{
    if (is_muted(ch))
        return;

    uint8_t lo = value & 0xFF;
    uint8_t hi = (value >> 8) & 0xFF;

    switch (ch) {
    case 0:
        channels[0].period = value;
        NR13 = lo;
        NR14 = hi | h;
        break;
    case 1:
        channels[1].period = value;
        NR23 = lo;
        NR24 = hi | h;
        break;
    case 2:
        channels[2].period = value;
        NR33 = lo;
        NR34 = hi | h;
        break;
    default:
        NR43 = get_note_poly(lo) | step_width4;
        NR44 = h;
        break;
    }
}

static void play_note(uint8_t ch)
{
    if (is_muted(ch))
        return;

    Channel *c = &channels[ch];
    switch (ch) {
    case 0:
        NR13 = c->period & 0xFF;
        NR14 = c->highmask | (c->period >> 8);
        break;
    case 1:
        NR23 = c->period & 0xFF;
        NR24 = c->highmask | (c->period >> 8);
        break;
    case 2:
        /* The asm stops and restarts CH3 around the trigger to dodge
         * a Game Boy wave RAM corruption bug. GBA: no such bug, but
         * restarting is harmless and keeps the channel enabled.
         * (0x80, not the asm's 0xFF: on GBA the extra NR30 bits
         * would switch to two-bank mode / bank 1.) */
        NR30 = 0;
        NR30 = NR30_PLAY_BANK0;
        NR33 = c->period & 0xFF;
        NR34 = c->highmask | (c->period >> 8);
        break;
    default:
        NR43 = c->period & 0xFF;
        NR44 = c->highmask;
        break;
    }
}

static void update_ch3_waveform(uint8_t index)
{
    current_wave = index;
    /* The asm uses swap(index) as the byte offset; masking keeps a
     * bad 9xx parameter from reading past the 16 waves. */
    const uint8_t *w = song->waves + (index & 0x0F) * 16;

    uint8_t pan = NR51;
    NR51 = pan & 0xBB;

    NR30 = NR30_WRITE_BANK0;
    for (int i = 0; i < 8; i++)
        WAVE_RAM[i] = w[i * 2] | (w[i * 2 + 1] << 8);
    NR30 = NR30_PLAY_BANK0;

    NR51 = pan;
}

static void note_cut(uint8_t ch)
{
    *reg_env[ch] = 0;
    if (ch == 2)
        return;
    *reg_go[ch] = 0xFF;   /* retrigger so the zero volume takes effect */
}

/*
 * One effect. `from_table` is the asm's "offset" entry (subpatterns
 * jump one byte into each handler, skipping its tick-0 check - so
 * effects there run on every tick). Returns 0 where the asm uses
 * ret_dont_play_note (the caller then doesn't play the row's note).
 */
static int do_effect(uint8_t ch, uint8_t b, uint8_t c, int from_table)
{
    uint8_t fx = b & 0x0F;
    if (fx == 0 && c == 0)
        return 1;

    Channel *chan = &channels[ch];
    int tick0 = (tick == 0);
    int only_tick0 = !from_table && !tick0;   /* "ret nz" handlers */
    int skip_tick0 = !from_table && tick0;    /* "ret z" handlers */

    switch (fx) {
    case 0x0: {     /* arpeggio */
        uint8_t k = (uint8_t)(counter - 1);
        while (k >= 3)
            k -= 3;
        uint8_t n = chan->note;
        if (k == 0)
            n += c & 0x0F;
        else if (k == 1)
            n += c >> 4;
        update_channel_freq(ch, get_note_period(n), 0);
        break;
    }
    case 0x1:       /* portamento up */
        if (skip_tick0)
            break;
        update_channel_freq(ch, (uint16_t)(chan->period + c), 0);
        break;
    case 0x2:       /* portamento down */
        if (skip_tick0)
            break;
        update_channel_freq(ch, (uint16_t)(chan->period - c), 0);
        break;
    case 0x3: {     /* tone portamento */
        /* Entering this one byte in from a subpattern lands mid-
         * instruction in the asm - undefined there, a no-op here. */
        if (from_table)
            break;
        if (tick0) {
            chan->toneporta_target = get_note_period(chan->note);
            return 0;
        }
        int cur = chan->period;
        int target = chan->toneporta_target;
        if (target < cur) {
            cur -= c;
            if (cur < target)
                cur = target;
        } else if (target > cur) {
            cur += c;
            if (cur > target)
                cur = target;
        }
        chan->period = (uint16_t)cur;
        /* Uses the highmask from before clearing its trigger bit, so
         * the first slide tick after an instrument note retriggers
         * (the note itself was held back on tick 0). */
        uint8_t h = chan->highmask;
        chan->highmask &= 0x7F;
        update_channel_freq(ch, (uint16_t)cur, h);
        break;
    }
    case 0x4: {     /* vibrato */
        if (skip_tick0)
            break;
        uint16_t period = get_note_period(chan->note);
        if ((counter & (c >> 4)) == 0)
            period += c & 0x0F;
        update_channel_freq(ch, period, 0);
        break;
    }
    case 0x5:       /* set master volume */
        if (only_tick0)
            break;
        NR50 = c;
        break;
    case 0x6:       /* call routine */
        /* hUGEDriver calls routine (c & 15) from the song's routine
         * table; GB Studio's "Set Music Routine" event attaches a
         * script to each id instead - music.c runs it. */
        if (routine_callback)
            routine_callback(c & 0x0F);
        break;
    case 0x7:       /* note delay */
        if (from_table)
            break;  /* undefined in the asm, see tone portamento */
        if (tick0)
            return 0;
        if (tick == c)
            play_note(ch);
        break;
    case 0x8:       /* set panning */
        if (only_tick0)
            break;
        NR51 = c;
        break;
    case 0x9:       /* set duty cycle / wave / noise mode */
        if (only_tick0 || is_muted(ch))
            break;
        if (ch == 0)
            NR11 = c;
        else if (ch == 1)
            NR21 = c;
        else if (ch == 3)
            NR43 = (NR43 & ~0x08) | c;
        else {
            update_ch3_waveform(c);
            play_note(2);
        }
        break;
    case 0xA: {     /* volume slide */
        if (only_tick0 || is_muted(ch))
            break;
        uint8_t down = c & 0x0F;
        uint8_t up = c >> 4;
        int vol = *reg_env[ch] >> 4;
        vol = vol < down ? 0 : vol - down;
        vol += up;
        if (vol > 15)
            vol = 15;
        *reg_env[ch] = (uint8_t)(vol << 4);
        /* The asm ORs the trigger bit into NRx4. GBA: its frequency
         * bits can't be read back, so rebuild them instead. */
        if (ch == 3)
            *reg_go[ch] = 0x80 | (chan->highmask & 0x40);
        else
            *reg_go[ch] = 0x80 | (chan->highmask & 0x40) | ((chan->period >> 8) & 0x07);
        play_note(ch);
        break;
    }
    case 0xB:       /* position jump */
        if (only_tick0)
            break;
        /* In the asm A still holds the tick here (0 unless from a
         * subpattern), OR'd with row_break. */
        if ((tick | row_break) == 0)
            row_break = 1;
        next_order = c;
        break;
    case 0xC: {     /* set volume */
        if (only_tick0 || is_muted(ch))
            break;
        uint8_t v = swap8(c);
        if (ch == 0 || ch == 1) {
            *reg_env[ch] = (*reg_env[ch] & 0x0F) | v;
            play_note(ch);
        } else if (ch == 2) {
            /* Quantize 0-15 down to the wave channel's 4 levels. */
            uint8_t level;
            if (v >= (10 << 4))
                level = 0x20;
            else if (v >= (5 << 4))
                level = 0x40;
            else if (v == 0)
                level = 0x00;
            else
                level = 0x60;
            NR32 = level;
        } else {
            NR42 = v;
            play_note(3);
        }
        break;
    }
    case 0xD:       /* pattern break */
        if (only_tick0)
            break;
        row_break = c;
        break;
    case 0xE:       /* note cut */
        /* From a subpattern the asm skips its "cp c", so it cuts only
         * on tick 0 there. */
        if (from_table ? !tick0 : tick != c)
            break;
        if (is_muted(ch))
            break;
        note_cut(ch);
        break;
    case 0xF:       /* set speed */
        if (only_tick0)
            break;
        ticks_per_row = c;
        break;
    }
    return 1;
}

/* Run one row of a channel's instrument subpattern ("table"). */
static void do_table(uint8_t ch)
{
    Channel *chan = &channels[ch];
    const uint8_t *cell = chan->table + (uint8_t)(chan->table_row * 3);
    chan->table_row++;

    uint8_t note = cell[0];
    uint8_t b = cell[1];
    uint8_t c = cell[2];

    /* Jump target: instrument nibble, plus bit 7 of the note byte as
     * its 5th bit. 0 = no jump, otherwise row + 1. */
    uint8_t jump = b >> 4;
    if (note & 0x80) {
        note &= 0x7F;
        jump |= 0x10;
    }
    if (jump)
        chan->table_row = jump - 1;

    if (note != NO_NOTE) {
        /* Subpattern notes are offsets from the row's note, centred
         * on 36. */
        uint8_t n = (uint8_t)(note - 36 + chan->note);
        uint8_t h = chan->highmask & 0x7F;
        if (ch == 3)
            update_channel_freq(ch, n, h);
        else
            update_channel_freq(ch, get_note_period(n), h);
    }

    do_effect(ch, b, c, 1);
}

void huge_init(const HugeSong *s)
{
    song = s;
    ticks_per_row = s->ticks_per_row;

    mute_channels = 0;
    counter = 0;
    tick = 0;
    row_break = 0;
    next_order = 0;
    row = 0;
    current_order = 0;
    step_width4 = 0;
    wrapped = 0;
    for (int ch = 0; ch < 4; ch++)
        channels[ch] = (Channel){0};

    current_wave = NO_WAVE;
    load_patterns(0);
}

void huge_mute_channel(uint8_t ch, uint8_t mute)
{
    mute_channels = (mute_channels & ~(1 << ch)) | ((mute & 1) << ch);
    if (mute)
        note_cut(ch);
}

int huge_song_wrapped(void)
{
    return wrapped;
}

void huge_silence(void)
{
    for (uint8_t ch = 0; ch < 4; ch++)
        note_cut(ch);
    NR30 = 0;
}

/* Tick 0 of a row: read each channel's cell, load instruments,
 * run effects, trigger notes. */
static void process_row(void)
{
    for (uint8_t ch = 0; ch < 4; ch++) {
        Channel *chan = &channels[ch];
        const uint8_t *cell = pattern[ch] + row * 3;
        uint8_t note = cell[0];
        uint8_t b = cell[1];
        uint8_t c = cell[2];
        int valid = note < LAST_NOTE;

        if (valid) {
            chan->note = note;

            if (ch < 3) {
                if ((b & 0x0F) != 3)    /* tone porta slides there instead */
                    chan->period = get_note_period(note);
            } else {
                chan->period = get_note_poly(note);
            }

            uint8_t instr = b >> 4;
            if (instr == 0) {
                chan->highmask &= 0x7F;     /* legato: no retrigger */
            } else if (!is_muted(ch)) {
                const HugeInstr *ins;
                switch (ch) {
                case 0:
                    ins = &song->duty_instruments[instr - 1];
                    NR10 = ins->b0;
                    NR11 = ins->b1;
                    NR12 = ins->b2;
                    chan->highmask = ins->highmask;
                    break;
                case 1:
                    ins = &song->duty_instruments[instr - 1];
                    NR21 = ins->b1;
                    NR22 = ins->b2;
                    chan->highmask = ins->highmask;
                    break;
                case 2:
                    ins = &song->wave_instruments[instr - 1];
                    NR31 = ins->b0;
                    NR32 = ins->b1;
                    if (ins->b2 != current_wave)
                        update_ch3_waveform(ins->b2);
                    chan->highmask = ins->highmask;
                    break;
                default:
                    ins = &song->noise_instruments[instr - 1];
                    NR42 = ins->b0;
                    NR41 = ins->highmask & 0x3F;
                    step_width4 = (ins->highmask & 0x80) >> 4;
                    chan->period |= step_width4;
                    chan->highmask = (ins->highmask & 0x40) | 0x80;
                    break;
                }
                chan->table = ins->table;
                chan->table_row = 0;
            }
        }

        int play = do_effect(ch, b, c, 0);
        if (valid && play)
            play_note(ch);

        if (chan->table)
            do_table(ch);
    }
}

/* Ticks 1+: only effects with a non-zero parameter, plus tables. */
static void process_effects(void)
{
    for (uint8_t ch = 0; ch < 4; ch++) {
        if (!is_muted(ch)) {
            const uint8_t *cell = pattern[ch] + row * 3;
            if (cell[2] != 0)
                do_effect(ch, cell[1], cell[2], 0);
        }
        if (channels[ch].table)
            do_table(ch);
    }
}

static void tick_time(void)
{
    counter++;
    tick++;
    if (tick != ticks_per_row)      /* 0 = 256 ticks, via 8-bit wrap */
        return;
    tick = 0;

    uint8_t start_row;
    uint8_t order;

    if (row_break) {
        /* Dxx / Bxx parameters are stored +1 so 0 means "unset". */
        start_row = row_break - 1;
        row_break = 0;
        if (next_order) {
            order = next_order - 1;
            next_order = 0;
            goto load;
        }
    } else {
        if (++row != PATTERN_LENGTH)
            return;
        start_row = 0;
    }

    order = current_order + 1;
    if (order >= song->order_count)
        wrapped = 1;

load:
    /* The asm trusts the song here; wrap bad jump targets instead of
     * reading past the order/pattern data. */
    if (order >= song->order_count)
        order = 0;
    current_order = order;
    load_patterns(order);
    row = start_row & (PATTERN_LENGTH - 1);
}

void huge_dosound(void)
{
    if (!song)
        return;
    if (tick == 0)
        process_row();
    else
        process_effects();
    tick_time();
}
