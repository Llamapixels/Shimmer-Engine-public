#ifndef ADVANCE_STATE_H
#define ADVANCE_STATE_H

#include <stdint.h>

/*
 * Global game state that scripts read and write (see script.h) and
 * that saves persist (see save.h): named flags (booleans - see
 * "flags" in project.json), inventory items (see "items" in
 * project.json), and named numeric variables (see "variables" in
 * project.json - counters, scores, timers, anything a boolean flag
 * can't hold). This is the live in-RAM copy; save_game() and the
 * boot-time load copy it to/from a SaveData.
 */

/* One int16_t per named variable, in SaveData.variables. Unlike flags/
 * items (each a single bit in a uint32_t bitfield, hard-capped at 32),
 * variables have no bitfield ceiling - this number is set by dialogue
 * text interpolation instead: a "{name}" in dialogue compiles to a
 * runtime marker (0x02 + a one-byte variable index, see dialogue.c's
 * expand_marker()), which can address at most 256 variables. Keep in
 * sync with MAX_VARIABLES in compiler/build_project.py and
 * NAMED_LIST_LIMIT in editor/src/components/common/NamedListSelect.tsx. */
#define MAX_VARIABLES 256

/* Call once at startup (or on loading a save) to set the starting
 * flags/inventory bitmasks and variable values. `variables` must
 * point to MAX_VARIABLES entries, or be 0 to zero-init all of them
 * (a fresh game / no save). */
void state_init(uint32_t flags, uint32_t inventory, const int16_t *variables);

int  flag_get(int index);     /* 0/1; index < 0 is always 0 */
void flag_set(int index);     /* no-op if index < 0 */
void flag_clear(int index);   /* no-op if index < 0 */

int  item_has(int index);     /* 0/1; index < 0 is always 0 */
void item_give(int index);    /* no-op if index < 0 */

int16_t var_get(int index);                 /* 0 if index is out of range */
void    var_set(int index, int16_t value);  /* no-op if index is out of range */
void    var_add(int index, int16_t delta);  /* no-op if index is out of range */

uint32_t state_flags(void);
uint32_t state_inventory(void);

/* MAX_VARIABLES entries, in variable-index order - for save_game()
 * to copy into a SaveData. Never null. */
const int16_t *state_variables(void);

#endif
