#include <assert.h>
#include <stdio.h>
#include "../../engine/source/entity.c"
#include "compiled/data/scenes_data.c"

static int tile_checks;
void sprite_init(ASprite *s, int x, int y, const ASpriteFrame *frames,
                 uint16_t count, uint8_t objs, uint16_t tiles, int bank)
{
    (void)s; (void)x; (void)y; (void)frames; (void)count; (void)objs; (void)tiles; (void)bank;
}
void sprite_hide(ASprite *s) { (void)s; }
void sprite_show_frame(ASprite *s, int frame) { (void)s; (void)frame; }
int collision_can_move_from(int ax, int ay, int bx, int by, int w, int h)
{
    (void)ax; (void)ay; (void)bx; (void)by; (void)w; (void)h;
    tile_checks++;
    return 0;
}
int main(void)
{
    entity_system_init();
    Entity *e = entity_create(ENTITY_NPC, 8, 8, 16, 16);
    assert(e && e->blocks_player && e->collide && !e->interaction_disabled);
    e->blocks_player = 0;
    assert(!entity_can_move(e, 9, 8) && tile_checks == 1);
    e->collision_group = 5;
    assert(!entity_can_move(e, 9, 8) && tile_checks == 2);
    e->collide = 0;
    assert(entity_can_move(e, 9, 8) && tile_checks == 2);
    e->hit_disabled = 31;
    e->interaction_disabled = e->pickup_collected = 1;
    entity_destroy(e);
    Entity *reused = entity_create(ENTITY_NPC, 0, 0, 16, 16);
    assert(reused == e && reused->blocks_player && reused->collide);
    assert(!reused->hit_disabled && !reused->interaction_disabled && !reused->pickup_collected);
    assert(reused->collision_group == 0);
    reused->def = &sprite_defs[1];
    entity_set_anim_state(reused, 2);
    assert(reused->anim_state == 2 && reused->anim_enabled);
    assert(reused->anim_index == reused->def->state_maps[2 * ENTITY_STATE_SLOTS]);
    entity_set_anim_state(reused, 3);
    assert(reused->anim_index == reused->def->state_maps[3 * ENTITY_STATE_SLOTS]);
    puts("Non-solid and pickup tile collisions and recycled entity defaults passed.");
    return 0;
}
