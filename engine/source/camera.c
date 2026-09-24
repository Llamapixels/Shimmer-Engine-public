#include "camera.h"
#include "background.h"
#include "rng.h"

static int camera_x = 0;
static int camera_y = 0;

static int world_width = SCREEN_WIDTH;
static int world_height = SCREEN_HEIGHT;

/* Screen shake - see camera_shake_start()'s doc comment in camera.h.
 * shake_x/shake_y are this frame's jitter, recomputed once per
 * camera_set_position() call (there's exactly one per frame - see
 * sync_camera() in main.c) and cached here for camera_get_display_x()/
 * camera_get_display_y() to read back without recomputing. */
static int shake_frames = 0;
static int shake_magnitude = 0;
static int shake_x = 0;
static int shake_y = 0;

void camera_init(void)
{
    camera_x = 0;
    camera_y = 0;
    shake_frames = 0;
    shake_x = 0;
    shake_y = 0;

    background_set_scroll(camera_x, camera_y);
}

void camera_set_bounds(
    int width,
    int height
)
{
    world_width = width;
    world_height = height;
}

void camera_set_position(
    int x,
    int y
)
{
    int max_x = world_width - SCREEN_WIDTH;
    int max_y = world_height - SCREEN_HEIGHT;

    /* World smaller than the screen: pin to 0. */
    if (max_x < 0) max_x = 0;
    if (max_y < 0) max_y = 0;

    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x > max_x) x = max_x;
    if (y > max_y) y = max_y;

    camera_x = x;
    camera_y = y;

    if (shake_frames > 0)
    {
        shake_x = rng_range(-shake_magnitude, shake_magnitude);
        shake_y = rng_range(-shake_magnitude, shake_magnitude);
        shake_frames--;
    }
    else
    {
        shake_x = 0;
        shake_y = 0;
    }

    background_set_scroll(camera_x + shake_x, camera_y + shake_y);
}

void camera_follow(
    int target_x,
    int target_y
)
{
    camera_set_position(
        target_x - SCREEN_WIDTH / 2,
        target_y - SCREEN_HEIGHT / 2
    );
}

int camera_get_x(void)
{
    return camera_x;
}

int camera_get_y(void)
{
    return camera_y;
}

void camera_shake_start(int frames, int magnitude)
{
    shake_frames = frames;
    shake_magnitude = magnitude;
}

int camera_get_display_x(void)
{
    return camera_x + shake_x;
}

int camera_get_display_y(void)
{
    return camera_y + shake_y;
}
