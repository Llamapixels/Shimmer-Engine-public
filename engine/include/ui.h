#ifndef ADVANCE_UI_H
#define ADVANCE_UI_H

#include <stdint.h>

/*
 * Dialogue-box fonts, frames and cursor (GB Studio style), drawn on BG1.
 *
 * Fonts are variable width: characters are drawn pixel by pixel into a
 * RAM "canvas" of tiles that fills the inside of the box, then copied to
 * VRAM. The box itself is a 9-slice frame (3x3 tiles: corners, edges,
 * centre), and the canvas starts out filled with the frame's centre tile,
 * so text sits on whatever the frame's fill looks like.
 *
 * All the data comes from compiler/ui.py (engine/data/ui_data.c): the
 * project's own fonts/frames/cursor, or the built-in defaults.
 */

/* One compiled font: per character 8 rows of 4bpp pixels (pixel x in
 * bits 4x..4x+3, 0 = see-through), and its width in pixels. */
typedef struct
{
    const uint32_t *glyphs;   /* count * 8 words */
    const uint8_t *widths;
    uint16_t count;
    uint8_t first;            /* character code of glyph 0 */
    uint8_t ink;              /* its main text colour (palette index) -
                               * what a !C colour code recolours */
} UiFont;

extern const UiFont ui_fonts[];
extern const uint32_t ui_frames[][72];   /* 9 tiles x 8 rows */
extern const uint32_t ui_cursor[8];
extern const uint16_t ui_palette[16];
extern const uint8_t ui_font_count;
extern const uint8_t ui_frame_count;
extern const uint8_t ui_default_font;
extern const uint8_t ui_default_frame;
extern const uint8_t ui_default_text_speed;

/* Control bytes inside compiled text (compiler/build_project.py's
 * interpolate_vars()). Each but UI_CODE_OPTION is followed by one
 * argument byte, stored +1 so it's never 0 (the end of the string). */
#define UI_CODE_OPTION  0x01   /* choice/menu option separator (no argument) */
#define UI_CODE_VAR     0x02   /* a = variable index 0-127: its decimal value */
#define UI_CODE_FONT    0x03   /* a = font index from here on */
#define UI_CODE_SPEED   0x04   /* a = frames per character from here on */
#define UI_CODE_VAR_HI  0x05   /* a = variable index 128-255, minus 128 */
#define UI_CODE_COLOR   0x06   /* a = palette index for the text colour from
                                * here on, 0 = the font's own colour */

#define UI_TEXT_WIDTH   224    /* px inside the box (28 tiles) */
#define UI_MAX_LINES    4      /* text lines the box can grow to */
#define UI_HUD_ROWS     4      /* debug HUD lines at the top of the screen */

void ui_init(void);

/* The font/frame/text speed dialogue uses from now on ("Set Font",
 * "Set Dialogue Frame", "Set Text Speed" events). Out of range = ignored. */
void ui_set_font(int font);
void ui_set_frame(int frame);
void ui_set_speed(int frames_per_char);
int ui_font(void);
int ui_speed(void);

/* Width in pixels of character `ch` in `font` (0 for unknown fonts). */
int ui_char_width(int font, unsigned char ch);

/* Where a dialogue box sits on screen (Display Text's "Position"). */
#define UI_BOX_BOTTOM 0
#define UI_BOX_TOP    1
#define UI_BOX_MIDDLE 2
#define UI_BOX_CUSTOM 3   /* anywhere: ui_box_open_at() */

/* Show the box, `lines` text lines tall, at the bottom of the screen,
 * with its canvas cleared to the frame's fill. */
void ui_box_open(int lines);
/* The same, at `position` (UI_BOX_*); framed = 0 draws no frame at all,
 * just the text on a see-through background. */
void ui_box_open_ex(int lines, int position, int framed);
/* Anywhere on screen: top-left corner at tile (col, row), `width` tiles
 * wide (frame included). Clamped to fit the screen. */
void ui_box_open_at(int lines, int col, int row, int width, int framed);
/* Pixels of text a line of the open box holds. */
int ui_text_width(void);
void ui_box_close(void);
void ui_box_clear(void);
/* Draw one character with its left edge at pixel x of text line `line`. */
void ui_box_char(int line, int x, int font, unsigned char ch);
/* ... with the font's ink drawn in palette colour `color` (0 = as is). */
void ui_box_char_color(int line, int x, int font, unsigned char ch, int color);
/* Draw the menu cursor at pixel x of text line `line`. */
void ui_box_cursor(int line, int x);
/* Copy the canvas to VRAM (after drawing). */
void ui_box_flush(void);

/* Debug HUD: text on a see-through background, top of the screen. */
void ui_hud_clear(void);
void ui_hud_text(int row, int x, const char *text);
void ui_hud_flush(void);

#endif
