#ifndef ADVANCE_CAMERA_H
#define ADVANCE_CAMERA_H

#define SCREEN_WIDTH  240
#define SCREEN_HEIGHT 160

void camera_init(void);

/* World size in pixels; the camera never shows past it. */
void camera_set_bounds(
    int width,
    int height
);

void camera_set_position(
    int x,
    int y
);

/* Center the camera on a point (clamped to the bounds). */
void camera_follow(
    int target_x,
    int target_y
);

int camera_get_x(void);
int camera_get_y(void);

/*
 * Screen shake (see SCRIPT_CAMERA_SHAKE in script.h). Starts (or
 * restarts, if already shaking) a random per-frame jitter of up to
 * +/-magnitude px on each axis, lasting `frames` frames, applied on
 * top of wherever the camera would otherwise be (following the
 * player, locked to an actor/point, or mid-pan) - it composes with
 * all of those rather than overriding them.
 *
 * Deliberately NOT folded into camera_get_x()/camera_get_y(): those
 * stay jitter-free because some callers (camera_step_to(), and
 * sync_camera() in main.c) read them back as the basis for next
 * frame's target, and feeding a shaken value into that math would
 * make the jitter accumulate into permanent camera drift instead of
 * shaking in place. camera_get_display_x()/camera_get_display_y()
 * below are the shaken values - use those (as main.c's sync_camera()
 * does) only for what's actually drawn: the background scroll
 * registers and every on-screen sprite's screen position, so
 * everything shakes together without corrupting the underlying
 * tracked position.
 */
void camera_shake_start(int frames, int magnitude);

/* Camera position plus this frame's shake jitter (if any) - see
 * camera_shake_start() above. Equal to camera_get_x()/camera_get_y()
 * whenever no shake is active. */
int camera_get_display_x(void);
int camera_get_display_y(void);

/*
 * Script-driven camera override (see SCRIPT_CAMERA_* in script.h).
 * Implemented in main.c, not camera.c - locking to an actor needs the
 * live per-scene NPC Entity array that main.c owns, and every one of
 * these also needs to be visible to the main loop's own per-frame
 * "who does the camera follow this frame" check (see main.c), so it
 * made more sense to keep all of it in one place than to have camera.c
 * reach back into main.c for NPC positions.
 *
 * While locked (any of the three lock/move calls below), ordinary
 * gameplay stops calling camera_follow(player) every frame - the
 * camera stays wherever a script put it until camera_release().
 */

/* Camera follows this actor's center every frame from now on, instead
 * of the player. Invalid actor index does nothing. */
void camera_lock_to_actor(int index);

/* Immediately locks the camera to a fixed point (px, the center of the
 * view - same convention as camera_follow()). */
void camera_lock_to_point(int x, int y);

/*
 * Pans the camera one frame closer to (target_x, target_y) (px, center
 * of the view), at the same per-frame speed as actor_step_toward(),
 * and locks it there once arrived (as camera_lock_to_point() would).
 * Returns 1 if still short of the target (call again next frame), 0
 * once it has arrived - see SCRIPT_CAMERA_MOVE_TO in script.c.
 */
int camera_step_to(int target_x, int target_y, int speed);

/* Goes back to following the player every frame, as normal. */
void camera_release(void);

#endif
