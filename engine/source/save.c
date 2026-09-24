#include <stddef.h>
#include <stdint.h>

#include "save.h"

/*
 * GBA cartridge SRAM: 32KB at 0x0E000000, battery-backed so it
 * survives power-off. Only 8-bit accesses are guaranteed reliable
 * (the SRAM chip sits on an 8-bit bus), so everything here goes
 * through a uint8_t pointer, one byte at a time.
 */
#define SRAM_BASE ((volatile uint8_t *)0x0E000000)

#define SAVE_MAGIC 0x31564441u   /* arbitrary, just has to be consistent */

/*
 * Emulators (mGBA, VBA, ...) scan the ROM for this exact string to
 * auto-detect the save type. Must survive the linker - hence `used`.
 */
__attribute__((used))
static const char save_type_id[36] = "SRAM_V113";

static uint8_t compute_checksum(const SaveData *data)
{
    const uint8_t *bytes = (const uint8_t *)data;
    uint8_t sum = 0;

    /* Every byte before the checksum field. Not sizeof - 1: the struct
     * has tail padding after checksum, so that would include it. */
    for (uint32_t i = 0; i < offsetof(SaveData, checksum); i++)
        sum += bytes[i];

    return sum;
}

/* Each slot gets a fixed 1KB stripe of the 32KB SRAM. Slot 0 starts
 * at offset 0 - where the single save always lived - so saves from
 * before slots existed still load as slot 0. */
#define SLOT_STRIDE 1024
_Static_assert(sizeof(SaveData) <= SLOT_STRIDE, "SaveData outgrew its SRAM slot");

static volatile uint8_t *slot_base(int slot)
{
    if (slot < 0 || slot >= SAVE_SLOT_COUNT)
        slot = 0;
    return SRAM_BASE + slot * SLOT_STRIDE;
}

void save_write(const SaveData *data)
{
    save_write_slot(0, data);
}

int save_read(SaveData *data)
{
    return save_read_slot(0, data);
}

void save_write_slot(int slot, const SaveData *data)
{
    SaveData copy = *data;
    copy.magic = SAVE_MAGIC;
    copy.checksum = compute_checksum(&copy);

    const uint8_t *bytes = (const uint8_t *)&copy;
    volatile uint8_t *dst = slot_base(slot);

    for (uint32_t i = 0; i < sizeof(SaveData); i++)
        dst[i] = bytes[i];
}

void save_clear_slot(int slot)
{
    volatile uint8_t *dst = slot_base(slot);

    /* Breaking the magic number is enough for save_read_slot() to
     * treat the slot as empty. */
    for (uint32_t i = 0; i < sizeof(uint32_t); i++)
        dst[i] = 0;
}

int save_read_slot(int slot, SaveData *data)
{
    uint8_t *bytes = (uint8_t *)data;
    volatile uint8_t *src = slot_base(slot);

    for (uint32_t i = 0; i < sizeof(SaveData); i++)
        bytes[i] = src[i];

    if (data->magic != SAVE_MAGIC)
        return 0;

    if (data->checksum != compute_checksum(data))
        return 0;

    return 1;
}
