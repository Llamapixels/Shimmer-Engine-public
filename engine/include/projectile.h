#ifndef ADVANCE_PROJECTILE_H
#define ADVANCE_PROJECTILE_H

#include <stdint.h>

/*
 * Projectiles ("Launch Projectile" event, SCRIPT_LAUNCH_PROJECTILE):
 * a sprite flying along a path (straight, a wave, an arc, a boomerang)
 * until it hits something, leaves the screen or runs out of time. It can
 * bounce off walls (and actors), stick where it lands, or linger there.
 * What it hits:
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
    PROJ_P_PATH,        /* PROJ_PATH_* */
    PROJ_P_AMP,         /* wave: px either side */
    PROJ_P_PERIOD,      /* wave: frames per wave */
    PROJ_P_GRAVITY,     /* 1/256 px per frame per frame, pulls it down */
    PROJ_P_LIFT,        /* 1/256 px per frame, thrown upwards at the start */
    PROJ_P_RETURN,      /* boomerang: frames before it turns back */
    PROJ_P_BOUNCES,     /* wall bounces before landing, 255 = forever */
    PROJ_P_LAND,        /* PROJ_LAND_* */
    PROJ_P_LINGER,      /* PROJ_LAND_LINGER: frames it stays */
    PROJ_P_LAND_STATE,  /* animation state + 1 once landed, 0 = keep */
    PROJ_P_COUNT
};

enum { PROJ_PATH_STRAIGHT, PROJ_PATH_WAVE, PROJ_PATH_ARC, PROJ_PATH_BOOMERANG };
/* Hitting a wall or the ground (once out of bounces). */
enum { PROJ_LAND_VANISH, PROJ_LAND_STICK, PROJ_LAND_LINGER };
/* projectiles_command(). */
enum { PROJ_CMD_RECALL, PROJ_CMD_REMOVE };

/* PROJ_P_TARGET: bit 0 = the player, bit g = actors in collision group g (1-3). */
#define PROJ_TARGET_PLAYER 1
#define PROJ_FLAG_PIERCE   1     /* keeps going after a hit */
#define PROJ_FLAG_WALLS    2     /* flies through walls */
#define PROJ_FLAG_FRONT    4     /* drawn in front of the player and actors */
#define PROJ_FLAG_FOLLOW   8     /* stays at its offset from the thrower (melee) */
#define PROJ_FLAG_ACTOR_BOUNCE 16   /* bounces off actors too */
#define PROJ_FLAG_MIRROR   32    /* offset X flips when fired to the left */

/* Scene change: drop them all (call before the sprite allocator resets). */
void projectiles_reset(void);

void projectile_launch(const int16_t *params);

/* "Recall Projectiles" / "Remove Projectiles": every projectile of
 * sprite_defs[sprite] (-1 = all) flies back to its thrower, or vanishes. */
void projectiles_command(int command, int sprite);

/* Move (when `move`), check hits and draw, every frame of play. */
void projectiles_update(int move, int camera_x, int camera_y);

#endif
