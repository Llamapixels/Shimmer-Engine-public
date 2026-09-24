#ifndef ADVANCE_RNG_H
#define ADVANCE_RNG_H

#include <stdint.h>

/*
 * A small shared xorshift PRNG - not cryptographic, just "good enough"
 * to make an NPC's wander pattern (see main.c) or a script's
 * SCRIPT_RANDOM_VAR (see script.h) unpredictable. One shared stream
 * for the whole engine, same as GB Studio's own single RNG.
 */

/* Restart the sequence from `seed` ("Seed Random Number Generator"). */
void rng_seed(uint32_t seed);

/* Raw 32-bit output. */
uint32_t rng_next(void);

/* A value in [min, max], inclusive. If max <= min, just returns min
 * (rather than dividing by a zero/negative span). */
int rng_range(int min, int max);

#endif
