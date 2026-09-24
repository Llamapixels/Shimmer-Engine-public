#include <gba.h>
#include <stdint.h>

#include "input.h"

static uint16_t current_keys = 0;
static uint16_t previous_keys = 0;

void input_init(void)
{
    current_keys = 0;
    previous_keys = 0;
}

void input_update(void)
{
    previous_keys = current_keys;

    /*
     * GBA buttons are active LOW.
     * Invert them so pressed = 1, and keep only the 10 real buttons.
     */
    current_keys = (uint16_t)(~REG_KEYINPUT & INPUT_ALL);
}

uint16_t input_held_mask(void)
{
    return current_keys;
}

int input_held(uint16_t key)
{
    return (current_keys & key) != 0;
}

int input_pressed(uint16_t key)
{
    return (current_keys & key) && !(previous_keys & key);
}

int input_released(uint16_t key)
{
    return !(current_keys & key) && (previous_keys & key);
}

int input_down(uint16_t key)
{
    return input_pressed(key);
}
