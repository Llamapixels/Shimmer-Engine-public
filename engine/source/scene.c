#include <gba.h>

#include "scene.h"
#include "background.h"
#include "collision.h"
#include "camera.h"

static const SceneDef *current_scene = 0;

void scene_load(const SceneDef *scene)
{
    /*
     * Forced blank while loading so the half-loaded scene
     * never shows on screen.
     */
    REG_DISPCNT |= 0x0080;

    /* Before the map: streaming fills rows around each band's scroll. */
    background_set_parallax(scene->parallax, scene->parallax_count);

    background_load_palettes(
        scene->palettes,
        scene->palette_count
    );

    background_load_tiles(
        scene->tiles,
        (uint32_t)scene->tile_count * 32
    );

    /*
     * Maps up to 64x64 tiles (512x512 px) fit in VRAM directly.
     * Bigger ones stream a scrolling window of themselves in as the
     * camera moves - see background_stream_begin().
     */
    if (scene->width > 64 || scene->height > 64)
    {
        background_stream_begin(
            scene->map,
            scene->width,
            scene->height
        );
    }
    else
    {
        background_load_map(
            scene->map,
            scene->width,
            scene->height
        );
    }

    collision_set_map(
        scene->collision,
        scene->width,
        scene->height
    );

    camera_set_bounds(
        scene->width * 8,
        scene->height * 8
    );

    current_scene = scene;

    REG_DISPCNT &= ~0x0080;
}

const SceneDef *scene_current(void)
{
    return current_scene;
}

const DoorDef *scene_check_doors(int px, int py, int pw, int ph)
{
    if (!current_scene || !current_scene->doors)
        return 0;

    /*
     * Trigger on the player's center point, not the whole bounding
     * box. A 16x16 player straddles two 8x8 tiles, so an overlap
     * test fires as soon as one pixel touches the door - which makes
     * a door next to a spawn point re-trigger instantly. Requiring
     * the center means you have to actually step into the doorway.
     */
    int cx = px + pw / 2;
    int cy = py + ph / 2;

    for (int i = 0; i < current_scene->door_count; i++)
    {
        const DoorDef *d = &current_scene->doors[i];

        int dx = d->x * 8;
        int dy = d->y * 8;
        int dw = d->width * 8;
        int dh = d->height * 8;

        if (cx >= dx && cx < dx + dw &&
            cy >= dy && cy < dy + dh)
        {
            return d;
        }
    }

    return 0;
}
