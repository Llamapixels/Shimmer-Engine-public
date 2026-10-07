#ifndef ADVANCE_DIALOGUE_H
#define ADVANCE_DIALOGUE_H

/*
 * A simple text box for NPC dialogue, drawn on its own background
 * layer (BG1) so it always sits on top of the scene and sprites.
 *
 * Greedy word-wrap across a couple of rows per page; '\n' in the
 * source string starts a new page (shown after the player presses A).
 *
 * Text/prompt/option strings may contain a variable reference (a 0x02
 * byte followed by a variable index byte - see script.h's ScriptEvent
 * and compiler/build_project.py's interpolate_vars(), the runtime side
 * of a JSON "{varname}"), substituted with that variable's current
 * decimal value when shown.
 */

/* One-time setup: loads the font into VRAM. Call once at startup. */
void dialogue_init(void);

/* Start showing `text`. Turns the dialogue box on. */
void dialogue_show(const char *text);

/* Display Text's options, packed into one int (SCRIPT_TEXT's `a`):
 * bits 0-1 position (UI_BOX_BOTTOM/TOP/MIDDLE), bits 2-4 text lines
 * (1-4, 0 = the default 2), bit 5 = no frame. 0 = the usual box. */
#define DIALOGUE_OPT_POSITION(o) ((o) & 3)
#define DIALOGUE_OPT_ROWS(o)     (((o) >> 2) & 7)
#define DIALOGUE_OPT_NO_FRAME    0x20
/* With position UI_BOX_CUSTOM, SCRIPT_TEXT's `b` places the box: tile
 * column, row and width (frame included). */
#define DIALOGUE_PLACE_X(p)      ((p) & 31)
#define DIALOGUE_PLACE_Y(p)      (((p) >> 5) & 31)
#define DIALOGUE_PLACE_W(p)      (((p) >> 10) & 31)
void dialogue_show_ex(const char *text, int options, int place);

/* "Focus" for the next box (text, choice or menu) until it closes:
 * DIALOGUE_FOCUS_DIM darkens and DIALOGUE_FOCUS_BLUR pixelates
 * (mosaic) everything but the box. 0 = off. */
#define DIALOGUE_FOCUS_DIM   1
#define DIALOGUE_FOCUS_BLUR  2
void dialogue_set_focus(int focus);

/* Is a dialogue box currently on screen? */
int dialogue_active(void);

/*
 * Call once per frame while dialogue_active(). Advances to the next
 * '\n'-separated page on an A press, or closes the box if there are
 * no more pages.
 */
void dialogue_update(void);

/*
 * A two-option prompt, shown in the same box. `packed` is
 * "prompt\x01optionA\x01optionB" - three parts in one string, split on
 * a 0x01 byte (see compiler/build_project.py's "choice" event, which
 * builds this from a JSON prompt + two options). Turns the box on and
 * sets dialogue_active(), same as dialogue_show() - existing code that
 * already gates on dialogue_active() needs no changes to also pause
 * for a choice.
 *
 * While active, Up/Down move the cursor between the two options and A
 * picks one, closing the box (dialogue_active() goes false, same as
 * plain text finishing).
 */
void dialogue_show_choice(const char *packed);

/*
 * A general 2-4 option menu, shown in the same box - unlike
 * dialogue_show_choice() this has no prompt line of its own (put a
 * dialogue_show() before it for one); every row is an option, so it
 * fits one more than the two-option choice box does. `packed` is
 * "option1\x01option2\x01..." (as many \x01-separated parts as
 * `option_count`, clamped to 2..4 - see compiler/build_project.py's
 * "menu" event). Up/Down wrap around instead of just toggling between
 * two, A picks one - same dialogue_active()/dialogue_last_choice()
 * contract as dialogue_show_choice() above.
 */
void dialogue_show_menu(const char *packed, int option_count);

/*
 * Which option was picked: 0-based. Only meaningful right after
 * dialogue_active() goes false following a dialogue_show_choice() or
 * dialogue_show_menu() - undefined after a plain dialogue_show()
 * closes.
 */
int dialogue_last_choice(void);

#endif
