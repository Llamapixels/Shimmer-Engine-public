#include <gba.h>
#include <stdint.h>

#include "dialogue.h"
#include "input.h"
#include "state.h"   /* var_get() - variable interpolation */
#include "ui.h"

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
#define MENU_MAX_OPTIONS UI_MAX_LINES

typedef struct
{
    int font;
    int speed;
    int color;   /* UI palette index for the text, 0 = the font's own */
} TextState;

typedef enum { MODE_NONE, MODE_TEXT, MODE_CHOICE, MODE_MENU } Mode;

static Mode mode = MODE_NONE;
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

/* MODE_CHOICE / MODE_MENU */
static int option_count;
static int cursor;
static int has_prompt;
static const char *prompt_start, *prompt_end;
static const char *option_start[MENU_MAX_OPTIONS];
static const char *option_end[MENU_MAX_OPTIONS];

static int is_code(unsigned char c)
{
    return c == UI_CODE_VAR || c == UI_CODE_VAR_HI || c == UI_CODE_FONT || c == UI_CODE_SPEED ||
           c == UI_CODE_COLOR;
}

/* A code's argument (stored +1, see ui.h); variable codes give the
 * variable's index. */
static int code_arg(unsigned char code, unsigned char byte)
{
    int a = byte - 1;
    return code == UI_CODE_VAR_HI ? a + 128 : a;
}

static int is_var(unsigned char c)
{
    return c == UI_CODE_VAR || c == UI_CODE_VAR_HI;
}

/* A variable's value as decimal digits; returns the length. */
static int var_digits(int index, char *buf)
{
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

/* Width of the word starting at p (up to a space, '\n', 0x01 or the
 * end), following font codes inside it. */
static int word_width(const char *p, int font)
{
    int w = 0;
    while (*p && *p != ' ' && *p != '\n' && *p != UI_CODE_OPTION)
    {
        unsigned char c = (unsigned char)*p;
        if (is_code(c) && p[1])
        {
            if (c == UI_CODE_FONT)
                font = code_arg(c, (unsigned char)p[1]);
            else if (is_var(c))
            {
                char d[8];
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

        while (*p && *p != ' ' && *p != '\n' && *p != UI_CODE_OPTION)
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
                    char d[8];
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
                char d[8];
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
    draw_options();
    input_block_presses(DIALOGUE_INPUT_DELAY);
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

void dialogue_show_ex(const char *text, int options, int place)
{
    TextState st = { ui_font(), ui_speed(), 0 };
    int rows = DIALOGUE_OPT_ROWS(options);
    text_lines = rows ? rows : TEXT_LINES;
    if (text_lines > UI_MAX_LINES)
        text_lines = UI_MAX_LINES;
    mode = MODE_TEXT;
    int framed = !(options & DIALOGUE_OPT_NO_FRAME);
    if (DIALOGUE_OPT_POSITION(options) == UI_BOX_CUSTOM)
        ui_box_open_at(text_lines, DIALOGUE_PLACE_X(place), DIALOGUE_PLACE_Y(place), DIALOGUE_PLACE_W(place), framed);
    else
        ui_box_open_ex(text_lines, DIALOGUE_OPT_POSITION(options), framed);
    start_page(text, st);
    input_block_presses(DIALOGUE_INPUT_DELAY);
}

int dialogue_active(void)
{
    return mode != MODE_NONE;
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
    mode = MODE_NONE;
    ui_box_close();
    input_block_presses(DIALOGUE_INPUT_DELAY);
}

void dialogue_update(void)
{
    if (mode == MODE_NONE)
        return;

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

    /* Revealing the page. */
    if (shown < page_chars)
    {
        if (input_pressed(INPUT_A))
        {
            shown = page_chars;
            render_page();
        }
        else if (++timer >= reveal_speed())
        {
            shown++;
            render_page();
        }
        return;
    }

    if (!input_pressed(INPUT_A))
        return;
    if (next_page)
    {
        start_page(next_page, end_state);
        input_block_presses(DIALOGUE_INPUT_DELAY);
    }
    else
        close_box();
}
