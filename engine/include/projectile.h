#ifndef ADVANCE_PROJECTILE_H
#define ADVANCE_PROJECTILE_H

#include <stdint.h>

/*
 * Projectiles ("Launch Projectile" event, SCRIPT_LAUNCH_PROJECTILE):
 * a sprite flying in a straight line until it hits something, leaves
 * the screen or runs out of time. What it hits:
 *   the player          -> the scene's On Player Hit for its group
 *   actors in a group   -> that actor's On Hit
 * Up to PROJECTILE_MAX at once; they belong to the current scene.
 *
 * The compiler packs the event into an int16 array (PROJ_P_* below).
 */
#define PROJECTILE_MAX 8

enum
{
    PROJ_P_SPRITE, PROJ_P_BANK, PROJ_P_SOURCE, PROJ_P_FACING, PROJ_P_VX, PROJ_P_VY,
    PROJ_P_SPEED, PROJ_P_LIFE, PROJ_P_GROUP, PROJ_P_TARGET, PROJ_P_FLAGS,
    PROJ_P_OFF_X, PROJ_P_OFF_Y,
    PROJ_P_COUNT
};

#define PROJ_TARGET_PLAYER 0     /* 1-3: actors in that group, 4: any actor with a group */
#define PROJ_TARGET_ANY    4
#define PROJ_FLAG_PIERCE   1     /* keeps going after a hit */
#define PROJ_FLAG_WALLS    2     /* flies through walls */

/* Scene change: drop them all (call before the sprite allocator resets). */
void projectiles_reset(void);

void projectile_launch(const int16_t *params);

/* Move (when `move`), check hits and draw, every frame of play. */
void projectiles_update(int move, int camera_x, int camera_y);

#endif
