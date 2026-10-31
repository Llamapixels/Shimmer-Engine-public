#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "projectile.h"
#include "actor.h"
#include "compiled/data/scenes_data.c"

int main(void)
{
    const NpcDef *a = &scenes[0]->npcs[0];
    const NpcDef *b = &scenes[0]->npcs[1];
    assert(a->collision_group == 4);
    assert(a->projectile_hit_disabled == 9);
    assert(!a->hit_groups[0]); /* explicit [] suppresses the legacy fallback */
    assert(a->hit_groups[1] == a->on_hit && a->hit_groups[2] == a->on_hit);
    assert(a->hit_groups[3] && a->hit_groups[3] != a->on_hit);
    assert(a->hit_groups[3][0].op == SCRIPT_ACTOR_HIDE);
    assert(a->hit_groups[3][0].a == 0); /* Self compiled as the owning actor */
    assert(a->on_player_hit && a->on_player_hit[0].op == SCRIPT_ACTOR_SHOW);
    assert(a->on_player_hit[0].a == 0 && a->player_hit_disabled);
    assert(b->on_player_hit && b->on_player_hit[0].op == SCRIPT_END);
    assert(!b->player_hit_disabled);
    assert(scenes[0]->player_hit[3]);
    assert(scenes[0]->player_hit[3][0].op == SCRIPT_WAIT);
    assert(scenes[0]->player_hit[3][0].a == 4);
    const ScriptEvent *response = scenes[0]->on_init;
    while (response->op != SCRIPT_END && response->op != SCRIPT_ACTOR_HIT_RESPONSE) response++;
    assert(response->op == SCRIPT_ACTOR_HIT_RESPONSE);
    assert(response->a == 0 && response->b == 16 && response->c == 1);
    const ScriptEvent *ev = scenes[0]->on_init;
    while (ev->op != SCRIPT_END && ev->op != SCRIPT_LAUNCH_PROJECTILE) ev++;
    assert(ev->op == SCRIPT_LAUNCH_PROJECTILE && ev->ptr);
    const int16_t *shot = ev->ptr;
    assert(shot[PROJ_P_GROUP] == 4 && shot[PROJ_P_TARGET] == 16);
    const NpcDef *enemy = &scenes[0]->npcs[2];
    assert(!enemy->non_solid && !enemy->collisions_disabled && !enemy->interaction_disabled);
    assert(enemy->hit_groups[3][0].op == SCRIPT_ACTOR_COLLISION_GROUP);
    assert(enemy->hit_groups[3][0].a == 2 && enemy->hit_groups[3][0].b == ACTOR_GROUP_PICKUP);
    assert(enemy->on_collect[0].op == SCRIPT_ADD_VAR && enemy->on_collect[0].b == 10);
    assert(enemy->on_collect[1].op == SCRIPT_ACTOR_REMOVE && enemy->on_collect[1].a == 2);
    ev++;
    assert(ev->op == SCRIPT_ACTOR_SET_SOLID && ev->a == 2 && ev->b == 0);
    ev++;
    assert(ev->op == SCRIPT_ACTOR_SET_INTERACTION && ev->a == 2 && ev->b == 0);
    const SceneDef *platform = scenes[1];
    assert(platform->mode == SCENE_MODE_PLATFORM);
    assert(platform->npcs[0].non_solid); /* unchecked Platform defaults to pass-through */
    assert(!platform->npcs[1].non_solid && platform->npcs[1].platform);
    assert(!platform->npcs[2].non_solid); /* an explicitly solid actor remains a wall */
    assert(platform->npcs[3].non_solid && platform->npcs[3].platform);
    assert(platform->npcs[4].collisions_disabled && platform->npcs[4].interaction_disabled);
    assert(platform->npcs[5].collision_group == 5 && platform->npcs[5].on_collect);
    ev++;
    assert(ev->op == SCRIPT_ACTOR_SET_STATE_NAME && ev->a == 0 && !strcmp(ev->str, "attack"));
    ev++;
    assert(ev->op == SCRIPT_ACTOR_SET_STATE_NAME && ev->a == 1 && !strcmp(ev->str, "attack"));
    ev++;
    assert(ev->op == SCRIPT_PLAYER_SET_SPRITE);
    const SpriteDef *alternate = &sprite_defs[ev->a];
    assert(!strcmp(alternate->state_names[3], "guard"));
    ev++;
    assert(ev->op == SCRIPT_ACTOR_SET_STATE_NAME && ev->a == PLAYER_ACTOR_INDEX && !strcmp(ev->str, "guard"));
    ev++;
    assert(ev->op == SCRIPT_ACTOR_SET_STATE_NAME && ev->a == PLAYER_ACTOR_INDEX && !strcmp(ev->str, "attack"));
    ev++;
    assert(ev->op == SCRIPT_ACTOR_SET_STATE_NAME && !strcmp(ev->str, alternate->state_names[4]));
    ev++;
    assert(ev->op == SCRIPT_ACTOR_SET_STATE && ev->a == PLAYER_ACTOR_INDEX && ev->b == 0);
    assert(scenes[0]->on_init[0].op == SCRIPT_ACTOR_SET_STATE_NAME && scenes[0]->on_init[0].a == 0);
    assert(platform->on_init[0].op == SCRIPT_ACTOR_SET_STATE_NAME && platform->on_init[0].a == 0);
    assert(scenes[0]->npc_count == 4);
    const NpcDef *coin = &scenes[0]->npcs[3];
    assert(coin->spawn_pool && coin->collision_group == 5 && coin->collect_touch_disabled);
    assert(coin->on_interact[0].op == SCRIPT_ACTOR_COLLECT && coin->on_interact[0].a == 3);
    assert(coin->on_collect[1].op == SCRIPT_ACTOR_REMOVE && coin->on_collect[1].a == 3);
    ev++;
    assert(ev->op == SCRIPT_SPAWN_PREFAB && ev->ptr);
    puts("Compiled actor handlers, legacy fallbacks, Self and group 4 checks passed.");
    return 0;
}
