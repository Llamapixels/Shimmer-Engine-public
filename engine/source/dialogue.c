#include <gba.h>
#include <stdint.h>

#include "dialogue.h"
#include "input.h"
#include "state.h"   /* var_get() - variable interpolation */
#include "ui.h"
#include "sprite.h"       /* sprite_set_mosaic() - focus blur; portraits */
#include "transition.h"   /* transition_active() - focus vs fades */
#include "scene.h"        /* sprite_defs[] - portraits */
#include "world.h"        /* speech bubbles over actors */
#include "actor.h"
#include "camera.h"

static void focus_start(void);
static void focus_end(void);

/*
 * Text boxes, choices and menus, drawn with ui.c's fonts and frames.
 *
 * Compiled text (compiler/build_project.py's interpolate_vars()) is plain
 * character bytes plus two-byte codes: UI_CODE_VAR/_HI (show a variable's
 * value), UI_CODE_FONT (switch font) and UI_CODE_SPEED (switch text
 * speed); '\n' starts a new page and 0x01 separates choice/menu parts.
 * Every scan below steps over a code and its argument together, so an
 * argument byte that happens to equal '\n' or 0x01 is never mistaken for
 * one.
 *
 * Text is word-wrapped by pixel width; a page that doesn't fit in the
 * box carries on as another page. Characters appear one at a time at the
 * current text speed (frames per character, 0 = instantly); A shows the
 * rest of the page at once, then A again moves on.
 */

#define TEXT_LINES       2    /* default text box height, in lines */
#define DIALOGUE_INPUT_DELAY 8   /* frames A/B/START ignored after a box
                                  * opens, turns a page or closes */
#define OPTION_X         10   /* px: text after the menu cursor */
#define SKIP_TURN_FRAMES 6    /* holding B: frames a shown page stays */
#define MENU_MAX_OPTIONS UI_MAX_LINES

typedef struct
{
    int font;
    int speed;
    int color;   /* UI palette index for the text, 0 = the font's own */
} TextState;

typedef enum { MODE_NONE, MODE_TEXT, MODE_CHOICE, MODE_MENU, MODE_HUD, MODE_NAME } Mode;

/* MODE_NAME: 3 rows of 14 cells, 16 px each. \x01 = upper / lower case,
 * \x02 = delete, \x03 = done. */
#define NAME_COLS 14
static const char NAME_GRID[3][NAME_COLS + 1] = {
    "ABCDEFGHIJKLMN",
    "OPQRSTUVWXYZ .",
    "0123456789-\x01\x02\x03",
};
static const char *name_prompt;
static int name_slot, name_max, name_len, name_cell, name_lower;
static char name_buf[NAME_MAX + 1];
static void close_box(void);

static Mode mode = MODE_NONE;
static int focus_pending;     /* the focus effect waits for the box to open */
static int last_choice = 0;
static int text_lines = TEXT_LINES;   /* lines in the current text box */

/* MODE_TEXT */
static const char *page;         /* start of the page on screen */
static const char *next_page;    /* start of the next one, 0 = last page */
static TextState page_state;     /* font/speed at the start of the page */
static TextState end_state;      /* ... and once it's all shown */
static int page_chars;           /* characters on the page */
static int shown;                /* characters revealed so far */
static int timer;

/* dialogue_set_extras() for the next box, then the box's own. */
static int next_portrait = -1, next_auto, next_bubble = DIALOGUE_NO_ACTOR;
static int auto_frames;          /* closes / turns by itself after this, 0 = waits */
static int auto_timer, skip_timer;
#define PORTRAIT_BANK 15         /* a portrait borrows this OBJ palette bank */
static ASprite portrait;
static DialogueHudSnap hud_now;   /* the HUD box up now (text 0 = none) */
static int portrait_on, portrait_pending;
static uint16_t portrait_saved_pal[16];

/* MODE_CHOICE / MODE_MENU */
static int option_count;
static int cursor;
static int has_prompt;
static const char *prompt_start, *prompt_end;
static const char *option_start[MENU_MAX_OPTIONS];
static const char *option_end[MENU_MAX_OPTIONS];

static int is_code(unsigned char c)
{
    return UI_IS_VAR_CODE(c) || c == UI_CODE_FONT || c == UI_CODE_SPEED || c == UI_CODE_COLOR;
}

/* A code's argument (stored +1, see ui.h); variable codes give the
 * variable's index. */
static int code_arg(unsigned char code, unsigned char byte)
{
    int a = byte - 1;
    return UI_IS_VAR_CODE(code) ? a + UI_VAR_BASE(code) : a;
}

static int is_var(unsigned char c)
{
    return UI_IS_VAR_CODE(c);
}

/* A variable's value as decimal digits (or a name's letters, for
 * UI_NAME_BASE + slot); returns the length. buf holds 16. */
static int var_digits(int index, char *buf)
{
    if (index >= UI_NAME_BASE)
    {
        const char *n = name_get(index - UI_NAME_BASE);
        int len = 0;
        while (n[len] && len < 15)
        {
            buf[len] = n[len];
            len++;
        }
        return len;
    }
    int value = var_get(index);
    char tmp[8];
    int n = 0, len = 0;
    if (value < 0)
    {
        buf[len++] = '-';
        value = -value;
    }
    do
    {
        tmp[n++] = (char)('0' + value % 10);
        value /= 10;
    } while (value > 0 && n < (int)sizeof(tmp));
    while (n > 0)
        buf[len++] = tmp[--n];
    return len;
}

/* Width of the word starting at p (up to a space, '\n', a line break,
 * 0x01 or the end), following font codes inside it. */
static int word_width(const char *p, int font)
{
    int w = 0;
    while (*p && *p != ' ' && *p != '\n' && *p != UI_CODE_LINE && *p != UI_CODE_OPTION)
    {
        unsigned char c = (unsigned char)*p;
        if (is_code(c) && p[1])
        {
            if (c == UI_CODE_FONT)
                font = code_arg(c, (unsigned char)p[1]);
            else if (is_var(c))
            {
                char d[16];
                int n = var_digits(code_arg(c, (unsigned char)p[1]), d);
                for (int i = 0; i < n; i++)
                    w += ui_char_width(font, (unsigned char)d[i]);
            }
            p += 2;
            continue;
        }
        w += ui_char_width(font, c);
        p++;
    }
    return w;
}

/*
 * Lay out one page: word-wrapped over text_lines lines. Draws the first
 * `limit` characters when `draw` is set. Returns how many characters the
 * page has; sets *next to where the following page starts (0 if none)
 * and updates *st to the font/speed in effect once `limit` characters
 * are shown.
 */
static int layout(const char *start, TextState *st, int limit, int draw, const char **next)
{
    const char *p = start;
    int line = 0, x = 0, count = 0;
    int font = st->font;
    int color = st->color;

    *next = 0;
    while (*p && *p != '\n' && *p != UI_CODE_OPTION)
    {
        if (*p == ' ')
        {
            if (x > 0)
            {
                x += ui_char_width(font, ' ');
                count++;
            }
            p++;
            continue;
        }

        /* A line break inside the box (Enter in Display Text). */
        if (*p == UI_CODE_LINE)
        {
            p++;
            line++;
            x = 0;
            if (line >= text_lines)
            {
                if (*p && *p != '\n')
                    *next = p;   /* more lines than the box: next page */
                else if (*p == '\n' && p[1])
                    *next = p + 1;
                break;
            }
            continue;
        }

        /* A word: wrap first if it doesn't fit on this line. */
        int w = word_width(p, font);
        if (x > 0 && x + w > ui_text_width())
        {
            line++;
            x = 0;
        }
        if (line >= text_lines)
        {
            *next = p;   /* carries on as another page */
            break;
        }

        while (*p && *p != ' ' && *p != '\n' && *p != UI_CODE_LINE && *p != UI_CODE_OPTION)
        {
            unsigned char c = (unsigned char)*p;
            if (is_code(c) && p[1])
            {
                int arg = code_arg(c, (unsigned char)p[1]);
                p += 2;
                if (c == UI_CODE_FONT)
                {
                    font = arg;
                    if (count <= limit)
                        st->font = arg;
                }
                else if (c == UI_CODE_SPEED)
                {
                    if (count <= limit)
                        st->speed = arg;
                }
                else if (c == UI_CODE_COLOR)
                {
                    color = arg;
                    if (count <= limit)
                        st->color = arg;
                }
                else
                {
                    char d[16];
                    int n = var_digits(arg, d);
                    for (int i = 0; i < n; i++)
                    {
                        if (draw && count < limit && x < ui_text_width())
                            ui_box_char_color(line, x, font, (unsigned char)d[i], color);
                        x += ui_char_width(font, (unsigned char)d[i]);
                        count++;
                    }
                }
                continue;
            }
            if (draw && count < limit && x < ui_text_width())
                ui_box_char_color(line, x, font, c, color);
            x += ui_char_width(font, c);
            count++;
            p++;
        }
    }

    if (*next == 0 && *p == '\n' && p[1])
        *next = p + 1;
    return count;
}

static void render_page(void)
{
    TextState st = page_state;
    const char *next;
    ui_box_clear();
    layout(page, &st, shown, 1, &next);
    ui_box_flush();
    timer = 0;
}

static void start_page(const char *text, TextState st)
{
    page = text;
    page_state = st;
    end_state = st;
    page_chars = layout(text, &end_state, 1 << 30, 0, &next_page);
    shown = st.speed == 0 ? page_chars : 0;
    render_page();
}

/* Current text speed while revealing: whatever the last code drawn set. */
static int reveal_speed(void)
{
    TextState st = page_state;
    const char *next;
    layout(page, &st, shown, 0, &next);
    return st.speed;
}

/* One line, no wrapping (choice prompts and options). */
static void draw_line(int line, int x, const char *s, const char *e, int font)
{
    int color = 0;
    while (s < e && *s)
    {
        unsigned char c = (unsigned char)*s;
        if (is_code(c) && s + 1 < e)
        {
            int arg = code_arg(c, (unsigned char)s[1]);
            s += 2;
            if (c == UI_CODE_FONT)
                font = arg;
            else if (c == UI_CODE_COLOR)
                color = arg;
            else if (is_var(c))
            {
                char d[16];
                int n = var_digits(arg, d);
                for (int i = 0; i < n; i++)
                {
                    ui_box_char_color(line, x, font, (unsigned char)d[i], color);
                    x += ui_char_width(font, (unsigned char)d[i]);
                }
            }
            continue;
        }
        if (x < ui_text_width())
            ui_box_char_color(line, x, font, c, color);
        x += ui_char_width(font, c);
        s++;
    }
}

/* End of the current part of a packed choice/menu string. */
static const char *part_end(const char *p)
{
    while (*p && *p != UI_CODE_OPTION)
        p += (is_code((unsigned char)*p) && p[1]) ? 2 : 1;
    return p;
}

static void draw_options(void)
{
    int first = has_prompt ? 1 : 0;
    ui_box_clear();
    if (has_prompt)
        draw_line(0, 0, prompt_start, prompt_end, ui_font());
    for (int i = 0; i < option_count; i++)
    {
        if (i == cursor)
            ui_box_cursor(first + i, 0);
        draw_line(first + i, OPTION_X, option_start[i], option_end[i], ui_font());
    }
    ui_box_flush();
}

static void open_options(const char *packed, int count, int prompt)
{
    const char *p = packed;
    has_prompt = prompt;
    if (prompt)
    {
        prompt_start = p;
        prompt_end = part_end(p);
        p = *prompt_end ? prompt_end + 1 : prompt_end;
    }
    for (int i = 0; i < count; i++)
    {
        option_start[i] = p;
        option_end[i] = part_end(p);
        p = *option_end[i] ? option_end[i] + 1 : option_end[i];
    }
    option_count = count;
    cursor = 0;
    text_lines = TEXT_LINES;
    ui_box_open(count + (prompt ? 1 : 0));
    ui_box_anim_open();
    focus_pending = 1;
    draw_options();
    input_block_presses(DIALOGUE_INPUT_DELAY);
}

/* ------------------------------------------------------------------ */
/* Focus: dim and/or blur everything but the box (BG1) while it's open.  */

#define FOCUS_BLEND  ((1 << 0) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (3 << 6))
#define FOCUS_LEVEL  9           /* of 16: how dark */
#define FOCUS_MOSAIC 0x3333      /* 4x4 blocks, BGs and sprites */

static int focus_next;           /* dialogue_set_focus(), for the next box */
static int focus_on;             /* what the open box turned on */

void dialogue_set_focus(int focus)
{
    focus_next = focus & 3;
}

static void focus_start(void)
{
    focus_on = 0;
    int f = focus_next;
    focus_next = 0;
    if (!f)
        return;
    if ((f & DIALOGUE_FOCUS_DIM) && !transition_active() && REG_BLDCNT == 0)
    {
        REG_BLDCNT = FOCUS_BLEND;
        REG_BLDY = FOCUS_LEVEL;
        focus_on |= DIALOGUE_FOCUS_DIM;
    }
    if (f & DIALOGUE_FOCUS_BLUR)
    {
        REG_MOSAIC = FOCUS_MOSAIC;
        REG_BG0CNT |= 1 << 6;
        REG_BG2CNT |= 1 << 6;
        REG_BG3CNT |= 1 << 6;
        sprite_set_mosaic(1);
        focus_on |= DIALOGUE_FOCUS_BLUR;
    }
}

static void focus_end(void)
{
    /* Undo only what's still ours (a fade may have taken the blend). */
    if ((focus_on & DIALOGUE_FOCUS_DIM) && REG_BLDCNT == FOCUS_BLEND && !transition_active())
    {
        REG_BLDCNT = 0;
        REG_BLDY = 0;
    }
    if (focus_on & DIALOGUE_FOCUS_BLUR)
    {
        REG_BG0CNT &= (uint16_t)~(1 << 6);
        REG_BG2CNT &= (uint16_t)~(1 << 6);
        REG_BG3CNT &= (uint16_t)~(1 << 6);
        REG_MOSAIC = 0;
        sprite_set_mosaic(0);
    }
    focus_on = 0;
}

void dialogue_init(void)
{
    ui_init();
    mode = MODE_NONE;
}

void dialogue_show(const char *text)
{
    dialogue_show_ex(text, 0, 0);
}

void dialogue_set_extras(int portrait_sprite, int frames, int bubble_actor)
{
    next_portrait = portrait_sprite;
    next_auto = frames;
    next_bubble = bubble_actor;
}

/* The portrait's frame and its size (from its OBJs), or 0. */
static const ASpriteFrame *portrait_frame(int sprite, int *frame_index, int *x0, int *y0, int *w, int *h)
{
    const SpriteDef *d = &sprite_defs[sprite];
    if (!d->anims || d->anim_count == 0 || d->anims[0].frame_count == 0)
        return 0;
    int fi = d->anims[0].frames[0];
    if (fi >= d->frame_count)
        return 0;
    const ASpriteFrame *f = &d->frames[fi];
    if (!f->objs || f->obj_count == 0)
        return 0;
    int minx = 999, miny = 999, maxx = -999, maxy = -999;
    for (int i = 0; i < f->obj_count; i++)
    {
        const ASpriteObj *o = &f->objs[i];
        if (o->dx < minx) minx = o->dx;
        if (o->dy < miny) miny = o->dy;
        if (o->dx + o->w > maxx) maxx = o->dx + o->w;
        if (o->dy + o->h > maxy) maxy = o->dy + o->h;
    }
    *frame_index = fi;
    *x0 = minx;
    *y0 = miny;
    *w = maxx - minx;
    *h = maxy - miny;
    return f;
}

static void portrait_hide(void)
{
    portrait_pending = 0;
    if (!portrait_on)
        return;
    portrait_on = 0;
    sprite_hide(&portrait);
    sprite_load_palette(PORTRAIT_BANK, portrait_saved_pal);
}

/* Draw the portrait at the start of the open box's text area. */
static void portrait_show(void)
{
    portrait_pending = 0;
    int fi, x0, y0, w, h;
    if (next_portrait < 0 || !portrait_frame(next_portrait, &fi, &x0, &y0, &w, &h))
        return;
    const SpriteDef *d = &sprite_defs[next_portrait];
    if (!portrait_on)
        sprite_save_palette(PORTRAIT_BANK, portrait_saved_pal);
    sprite_load_palette(PORTRAIT_BANK, d->palette);
    sprite_init_portrait(&portrait, d->frames, d->frame_count, d->max_objs, d->max_vram_tiles, PORTRAIT_BANK);
    sprite_show_frame(&portrait, fi);
    int tx, ty;
    ui_box_text_origin(&tx, &ty);
    sprite_set_position(&portrait, tx - x0, ty - y0);
    sprite_update(&portrait);
    portrait_on = 1;
}

/* Widest line of `text` in pixels (codes skipped, variables as 3 digits). */
static int text_width_px(const char *p, int font)
{
    int w = 0, best = 0;
    for (; *p && *p != UI_CODE_OPTION; p++)
    {
        unsigned char c = (unsigned char)*p;
        if (c == '\n' || c == UI_CODE_LINE)
        {
            w = 0;
            continue;
        }
        if (is_code(c) && p[1])
        {
            if (c == UI_CODE_FONT)
                font = code_arg(c, (unsigned char)p[1]);
            else if (is_var(c))
                w += 3 * ui_char_width(font, '0');
            p++;
            continue;
        }
        w += ui_char_width(font, c);
        if (w > best)
            best = w;
    }
    return best;
}

/* A speech bubble: a box just above the actor (below it when there's no
 * room), as wide as the text needs. Returns 0 if the actor isn't there. */
static int open_bubble(const char *text, int actor, int framed, int font, int inset)
{
    Entity *e = actor == PLAYER_ACTOR_INDEX ? world_player() : world_npc(actor);
    if (!e)
        return 0;
    int sx = e->pinned ? e->x : e->x - camera_get_x();
    int sy = e->pinned ? e->y : e->y - camera_get_y();
    /* Over the sprite as drawn (it can be taller than its footprint). */
    const ASprite *spr = &e->sprite;
    int top = 0;
    if (spr->frames && spr->current_frame >= 0 && spr->current_frame < spr->frame_count)
    {
        const ASpriteFrame *f = &spr->frames[spr->current_frame];
        for (int i = 0; i < f->obj_count; i++)
            if (f->objs[i].dy < top)
                top = f->objs[i].dy;
    }
    sy += top;
    int cols = (text_width_px(text, font) + 7) / 8 + inset + (framed ? 2 : 0) + 1;
    if (cols > 22) cols = 22;
    if (cols < (framed ? 4 : 2)) cols = framed ? 4 : 2;
    int rows = text_lines + (framed ? 2 : 0);
    int col = (sx + e->width / 2) / 8 - cols / 2;
    int row = sy / 8 - rows;
    if (row < 0)
        row = (sy - top + e->height + 7) / 8;   /* no room above: below its feet */
    ui_box_open_at(text_lines, col, row, cols, framed);
    return 1;
}

void dialogue_show_ex(const char *text, int options, int place)
{
    TextState st = { ui_font(), ui_speed(), 0 };
    int rows = DIALOGUE_OPT_ROWS(options);
    text_lines = rows ? rows : TEXT_LINES;
    if (text_lines > UI_MAX_LINES)
        text_lines = UI_MAX_LINES;
    int hud = (options & DIALOGUE_OPT_HUD) != 0;
    if (hud && mode != MODE_NONE && mode != MODE_HUD)
    {
        next_portrait = -1;
        next_auto = 0;
        next_bubble = DIALOGUE_NO_ACTOR;
        return;   /* a real box is up: it wins */
    }
    mode = hud ? MODE_HUD : MODE_TEXT;
    hud_now.text = hud ? text : 0;
    hud_now.options = options;
    hud_now.place = place;
    hud_now.portrait = next_portrait;
    int framed = !(options & DIALOGUE_OPT_NO_FRAME);
    auto_frames = next_auto;
    auto_timer = skip_timer = 0;

    /* A portrait takes the first columns of the box, and as many lines as
     * it is tall. */
    int inset = 0, fi, x0, y0, pw, ph;
    if (next_portrait >= 0 && portrait_frame(next_portrait, &fi, &x0, &y0, &pw, &ph))
    {
        inset = (pw + 7) / 8 + 1;
        int need = (ph + 7) / 8;
        if (need > text_lines)
            text_lines = need > UI_MAX_LINES ? UI_MAX_LINES : need;
    }
    else
        next_portrait = -1;
    ui_box_set_inset(inset);

    if (next_bubble == DIALOGUE_NO_ACTOR || !open_bubble(text, next_bubble, framed, st.font, inset))
    {
        ui_box_set_inset(inset);
        if (DIALOGUE_OPT_POSITION(options) == UI_BOX_CUSTOM)
            ui_box_open_at(text_lines, DIALOGUE_PLACE_X(place), DIALOGUE_PLACE_Y(place), DIALOGUE_PLACE_W(place), framed);
        else
            ui_box_open_ex(text_lines, DIALOGUE_OPT_POSITION(options), framed);
    }
    next_bubble = DIALOGUE_NO_ACTOR;
    next_auto = 0;
    if (next_portrait >= 0)
    {
        if (hud)
            portrait_show();
        else
            portrait_pending = 1;   /* once the box has finished opening */
    }
    else
        portrait_hide();
    if (hud)
    {
        /* The first page, all at once; no focus, no waiting for A. */
        start_page(text, st);
        shown = page_chars;
        render_page();
        return;
    }
    ui_box_anim_open();
    focus_pending = 1;
    start_page(text, st);
    input_block_presses(DIALOGUE_INPUT_DELAY);
}

int dialogue_hud_up(void)
{
    return mode == MODE_HUD;
}

void dialogue_hud_snapshot(DialogueHudSnap *out)
{
    *out = hud_now;
    if (mode != MODE_HUD)
        out->text = 0;
}

void dialogue_hud_restore(const DialogueHudSnap *in)
{
    if (!in->text || (mode != MODE_NONE && mode != MODE_HUD))
        return;
    dialogue_set_extras(in->portrait, 0, DIALOGUE_NO_ACTOR);
    dialogue_show_ex(in->text, in->options, in->place);
}

void dialogue_hud_close(void)
{
    hud_now.text = 0;
    if (mode != MODE_HUD)
        return;
    mode = MODE_NONE;
    portrait_hide();
    ui_box_close();
}

int dialogue_active(void)
{
    return mode != MODE_NONE && mode != MODE_HUD;
}

static char name_cell_char(int cell)
{
    char c = NAME_GRID[cell / NAME_COLS][cell % NAME_COLS];
    return name_lower && c >= 'A' && c <= 'Z' ? (char)(c + 32) : c;
}

static void draw_name_entry(void)
{
    ui_box_clear();
    /* Line 0: the prompt, then the name so far and a cursor. */
    const char *pe = name_prompt;
    while (*pe)
        pe++;
    draw_line(0, 0, name_prompt, pe, ui_font());
    int x = ui_text_width() - (NAME_MAX + 1) * 7;
    for (int i = 0; i < name_len; i++)
    {
        ui_box_char_color(0, x, ui_font(), (unsigned char)name_buf[i], 0);
        x += ui_char_width(ui_font(), (unsigned char)name_buf[i]);
    }
    if (name_len < name_max)
        ui_box_char_color(0, x, ui_font(), '_', 0);
    /* Lines 1-3: the grid, the cursor before the chosen cell. */
    for (int cell = 0; cell < 3 * NAME_COLS; cell++)
    {
        int line = 1 + cell / NAME_COLS, cx = (cell % NAME_COLS) * 16;
        if (cell == name_cell)
            ui_box_cursor(line, cx);
        char c = name_cell_char(cell);
        const char *label = c == '\x01' ? (name_lower ? "A" : "a") : c == '\x02' ? "<" : c == '\x03' ? "OK" : 0;
        if (label)
        {
            int lx = cx + 7;
            for (; *label; label++)
            {
                ui_box_char_color(line, lx, ui_font(), (unsigned char)*label, 0);
                lx += ui_char_width(ui_font(), (unsigned char)*label);
            }
        }
        else
            ui_box_char_color(line, cx + 8, ui_font(), (unsigned char)c, 0);
    }
    ui_box_flush();
}

void dialogue_show_name_entry(const char *prompt, int slot, int max_len)
{
    mode = MODE_NAME;
    /* prompt is "prompt" or "prompt\x01default name". */
    static char prompt_copy[64];
    const char *def = "";
    int k = 0;
    for (; prompt && prompt[k] && prompt[k] != UI_CODE_OPTION && k < 63; k++)
        prompt_copy[k] = prompt[k];
    prompt_copy[k] = 0;
    if (prompt && prompt[k] == UI_CODE_OPTION)
        def = prompt + k + 1;
    name_prompt = prompt_copy;
    name_slot = slot;
    name_max = max_len < 1 ? 1 : max_len > NAME_MAX ? NAME_MAX : max_len;
    const char *cur = name_get(slot)[0] ? name_get(slot) : def;
    name_len = 0;
    while (cur[name_len] && name_len < name_max)
    {
        name_buf[name_len] = cur[name_len];
        name_len++;
    }
    name_buf[name_len] = 0;
    name_cell = 0;
    name_lower = 0;
    text_lines = 4;
    ui_box_open(4);
    ui_box_anim_open();
    focus_pending = 1;
    draw_name_entry();
    input_block_presses(DIALOGUE_INPUT_DELAY);
}

/* MODE_NAME, a frame: move, type, delete, finish. */
static void name_entry_update(void)
{
    int moved = 0;
    int row = name_cell / NAME_COLS, col = name_cell % NAME_COLS;
    if (input_pressed(INPUT_LEFT)) { col = (col + NAME_COLS - 1) % NAME_COLS; moved = 1; }
    if (input_pressed(INPUT_RIGHT)) { col = (col + 1) % NAME_COLS; moved = 1; }
    if (input_pressed(INPUT_UP)) { row = (row + 2) % 3; moved = 1; }
    if (input_pressed(INPUT_DOWN)) { row = (row + 1) % 3; moved = 1; }
    name_cell = row * NAME_COLS + col;
    int done = input_pressed(INPUT_START);
    if (input_pressed(INPUT_SELECT))
    {
        name_lower = !name_lower;
        moved = 1;
    }
    if (input_pressed(INPUT_B) && name_len > 0)
    {
        name_buf[--name_len] = 0;
        moved = 1;
    }
    if (input_pressed(INPUT_A))
    {
        char c = name_cell_char(name_cell);
        if (c == '\x01')
            name_lower = !name_lower;
        else if (c == '\x02')
        {
            if (name_len > 0)
                name_buf[--name_len] = 0;
        }
        else if (c == '\x03')
            done = 1;
        else if (name_len < name_max)
        {
            name_buf[name_len++] = c;
            name_buf[name_len] = 0;
            if (name_len == name_max)
                name_cell = 3 * NAME_COLS - 1;   /* full: onto OK */
        }
        moved = 1;
    }
    if (done)
    {
        name_set(name_slot, name_buf);
        close_box();
        return;
    }
    if (moved)
        draw_name_entry();
}

void dialogue_show_choice(const char *packed)
{
    mode = MODE_CHOICE;
    open_options(packed, 2, 1);
}

void dialogue_show_menu(const char *packed, int count)
{
    if (count < 2)
        count = 2;
    if (count > MENU_MAX_OPTIONS)
        count = MENU_MAX_OPTIONS;
    mode = MODE_MENU;
    open_options(packed, count, 0);
}

int dialogue_last_choice(void)
{
    return last_choice;
}

static void close_box(void)
{
    portrait_hide();
    mode = MODE_NONE;
    focus_pending = 0;
    focus_end();
    ui_box_anim_close();   /* the box closes when its animation ends */
    input_block_presses(DIALOGUE_INPUT_DELAY);
}

void dialogue_update(void)
{
    if (mode == MODE_NONE || mode == MODE_HUD)
        return;

    /* Still opening: nothing happens in it yet. Then the focus effect. */
    if (ui_box_animating())
        return;
    if (focus_pending)
    {
        focus_pending = 0;
        focus_start();
    }
    if (portrait_pending)
        portrait_show();

    if (mode == MODE_NAME)
    {
        name_entry_update();
        return;
    }

    if (mode == MODE_CHOICE || mode == MODE_MENU)
    {
        if (input_pressed(INPUT_UP))
        {
            cursor = (cursor - 1 + option_count) % option_count;
            draw_options();
        }
        else if (input_pressed(INPUT_DOWN))
        {
            cursor = (cursor + 1) % option_count;
            draw_options();
        }
        if (input_pressed(INPUT_A))
        {
            last_choice = cursor;
            close_box();
        }
        return;
    }

    /* Settings > Dialogue "Hold B to skip": B shows the page at once, and
     * held on, turns pages every few frames. */
    int skipping = ui_text_skip_b && input_held(INPUT_B);

    /* Revealing the page. */
    if (shown < page_chars)
    {
        if (input_pressed(INPUT_A) || skipping)
        {
            shown = page_chars;
            render_page();
        }
        else if (++timer >= reveal_speed())
        {
            shown++;
            render_page();
        }
        auto_timer = skip_timer = 0;
        return;
    }

    int go = input_pressed(INPUT_A);
    if (skipping && ++skip_timer >= SKIP_TURN_FRAMES)
        go = 1;
    if (auto_frames && ++auto_timer >= auto_frames)
        go = 1;
    if (!go)
        return;
    auto_timer = skip_timer = 0;
    if (next_page)
    {
        start_page(next_page, end_state);
        input_block_presses(DIALOGUE_INPUT_DELAY);
    }
    else
        close_box();
}
