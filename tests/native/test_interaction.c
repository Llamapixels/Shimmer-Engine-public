#include <assert.h>
#include <stdio.h>
#include "../../engine/source/modes.c"

static Entity npc;
static NpcDef npc_def;
static const ScriptEvent interact[] = {{ .op = SCRIPT_WAIT, .a = 1 }, { .op = SCRIPT_END }};
int world_npc_count(void) { return 1; }
Entity *world_npc(int i) { return i == 0 ? &npc : 0; }
const NpcDef *world_npc_def(int i) { (void)i; return &npc_def; }
int world_npc_active(int i) { return i == 0 && npc.active && npc.solid && !npc.pinned; }
int world_npc_solid(int i) { return world_npc_active(i) && npc.collide && npc.blocks_player && npc.collision_group != 5; }

const ScriptEvent *world_npc_interact_script(int i) {
    return world_npc_active(i) && !npc.interaction_disabled ? npc_def.on_interact : 0;
}

int main(void)
{
    Entity player = { .active = 1, .solid = 1, .collide = 1, .blocks_player = 1, .col_w = 16, .col_h = 16 };
    npc = player;
    npc.x = 16;
    npc_def.on_interact = interact;
    mode = SCENE_MODE_PLATFORM;
    assert(touching_actor_script(&player) == interact);
    assert(npc_in_way(&player, 1, 0) == 1);
    npc.collide = 0;
    assert(touching_actor_script(&player) == interact);
    assert(npc_in_way(&player, 1, 0) == 0);
    npc.pinned = 1;
    assert(!touching_actor_script(&player));
    npc.pinned = 0;
    npc.solid = 0;
    assert(!touching_actor_script(&player));
    npc.solid = 1;
    npc.collide = 1;
    npc.blocks_player = 0;
    assert(!npc_in_way(&player, 1, 0) && touching_actor_script(&player) == interact);
    npc.interaction_disabled = 1;
    assert(!touching_actor_script(&player) && !npc_in_way(&player, 1, 0));
    npc.interaction_disabled = 0;
    npc.blocks_player = 1;
    npc_def.platform = 1;
    npc.x = 0;
    npc.y = 16;
    assert(npc_in_way(&player, 0, 1) == 1); /* one-way landing */
    npc.blocks_player = 0;
    assert(npc_in_way(&player, 0, 1) == 0);
    npc.blocks_player = 1;
    npc.collision_group = 5;
    assert(npc_in_way(&player, 0, 1) == 0); /* former platform pickup */
    npc.collision_group = 1;
    player.blocks_player = 0;
    assert(npc_in_way(&player, 0, 1) == 0);
    player.blocks_player = 1;
    npc.x = 80;
    assert(!touching_actor_script(&player));
    puts("Platformer interaction and solidity regression checks passed.");
    return 0;
}
