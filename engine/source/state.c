#include "state.h"

static uint32_t game_flags = 0;
static uint32_t game_inventory = 0;
static int16_t  game_variables[MAX_VARIABLES];

void state_init(uint32_t flags, uint32_t inventory, const int16_t *variables)
{
    game_flags = flags;
    game_inventory = inventory;

    for (int i = 0; i < MAX_VARIABLES; i++)
        game_variables[i] = variables ? variables[i] : 0;
}

int flag_get(int index)
{
    if (index < 0)
        return 0;

    return (int)((game_flags >> index) & 1u);
}

void flag_set(int index)
{
    if (index < 0)
        return;

    game_flags |= (1u << index);
}

void flag_clear(int index)
{
    if (index < 0)
        return;

    game_flags &= ~(1u << index);
}

int item_has(int index)
{
    if (index < 0)
        return 0;

    return (int)((game_inventory >> index) & 1u);
}

void item_give(int index)
{
    if (index < 0)
        return;

    game_inventory |= (1u << index);
}

uint32_t state_flags(void)
{
    return game_flags;
}

uint32_t state_inventory(void)
{
    return game_inventory;
}

int16_t var_get(int index)
{
    if (index < 0 || index >= MAX_VARIABLES)
        return 0;

    return game_variables[index];
}

void var_set(int index, int16_t value)
{
    if (index < 0 || index >= MAX_VARIABLES)
        return;

    game_variables[index] = value;
}

void var_add(int index, int16_t delta)
{
    if (index < 0 || index >= MAX_VARIABLES)
        return;

    game_variables[index] = (int16_t)(game_variables[index] + delta);
}

const int16_t *state_variables(void)
{
    return game_variables;
}
