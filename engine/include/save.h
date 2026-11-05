#ifndef ADVANCE_SAVE_H
#define ADVANCE_SAVE_H

#include <stdint.h>

#include "state.h"   /* MAX_VARIABLES */

/*
 * One save slot, written to the cartridge's battery-backed SRAM.
 * Add fields here as the game grows (inventory, flags, ...) - just
 * keep save_write/save_read as the only things that touch SRAM, and
 * keep new fields BEFORE checksum (which must stay last - see
 * save.c's compute_checksum()) and AFTER everything already here, so
 * old saves fail the checksum cleanly instead of reading garbage
 * into a field that didn't used to exist.
 */
typedef struct
{
    uint32_t magic;            /* set by save_write - ignore when filling this in */
    uint32_t flags;            /* one bit per named flag - see "flags" in project.json */
    uint32_t inventory;        /* one bit per named item - see "items" in project.json */
    uint8_t  scene_index;      /* index into scenes[] */
    int16_t  player_x;         /* pixels */
    int16_t  player_y;
    uint8_t  player_direction;
    int16_t  variables[MAX_VARIABLES]; /* see "variables" in project.json */
    uint32_t playtime;         /* frames on the playtime clock */
    char     names[NAME_SLOTS][NAME_MAX + 1];   /* "Enter Name" */
    uint8_t  checksum;         /* set by save_write - ignore when filling this in */
} SaveData;

/* Persistent data: kept apart from the save slots, so starting a new game
 * or clearing a save leaves it (settings, unlockables, total playtime). */
#define PERSIST_GROUPS 4
typedef struct
{
    uint32_t magic;
    int16_t  variables[MAX_VARIABLES];
    uint8_t  stored[MAX_VARIABLES / 8];   /* bit per variable: has a value here */
    uint32_t playtime;
    uint8_t  has_playtime;
    uint8_t  checksum;
} PersistData;

/* Reads a group (0 = empty or broken: everything cleared), writes it back. */
int  persist_read(int group, PersistData *data);
void persist_write(int group, const PersistData *data);
void persist_clear(int group);

/* Save slots (GB Studio's Save/Load/Clear Data events pick one of
 * these). The pause menu's SAVE and boot-time resume use slot 0. */
#define SAVE_SLOT_COUNT 8

void save_write_slot(int slot, const SaveData *data);
int  save_read_slot(int slot, SaveData *data);   /* 1 = valid save */
void save_clear_slot(int slot);

/* Slot 0 versions of the above. */

/* Stamps magic + checksum and writes the whole struct to SRAM. */
void save_write(const SaveData *data);

/*
 * Reads SRAM into `data`. Returns 1 if it held a valid save (magic
 * and checksum both check out), 0 if there's no save yet (fresh
 * cartridge / first boot) or it's corrupted - in which case `data`
 * shouldn't be used.
 */
int save_read(SaveData *data);

#endif
