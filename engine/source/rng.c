#include "rng.h"

/* Moved out of main.c (where it started as a private helper just for
 * NPC wandering) so script.c's SCRIPT_RANDOM_VAR can share the same
 * stream instead of needing its own separate one. */
static uint32_t rng_state = 2463534242u;   /* nonzero seed */

uint32_t rng_next(void)
{
    rng_state ^= rng_state << 13;
    rng_state ^= rng_state >> 17;
    rng_state ^= rng_state << 5;
    return rng_state;
}

int rng_range(int min, int max)
{
    if (max <= min)
        return min;

    uint32_t span = (uint32_t)(max - min) + 1;
    return min + (int)(rng_next() % span);
}

void rng_seed(uint32_t seed)
{
    /* xorshift must never hold 0 - it would stay 0 forever. */
    rng_state = seed ? seed : 2463534242u;
}
