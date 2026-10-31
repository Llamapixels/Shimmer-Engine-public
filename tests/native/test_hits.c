#include <assert.h>
#include <stdio.h>
#include <string.h>
#define main cartridge_main
#include "../../engine/source/main.c"
#undef main
#include "../../engine/source/projectile.c"
#include "compiled/data/scenes_data.c"

static SceneDef test_scene;
static Entity player, npc;
static NpcDef npc_def;
static int hit_count, run_count, thread_count, busy, threads_full;
static const ScriptEvent *last_script;
static const ScriptEvent player_script[] = {{ .op = SCRIPT_WAIT, .a = 1 }, { .op = SCRIPT_END }};
static const ScriptEvent actor_script[] = {{ .op = SCRIPT_WAIT, .a = 2 }, { .op = SCRIPT_END }};
static const ScriptEvent empty_script[] = {{ .op = SCRIPT_END }};
int16_t mode_settings[MS_COUNT];
const SceneDef *scene_current(void) { return &test_scene; }
void modes_player_hit(Entity *p, int x, int y) { (void)p; (void)x; (void)y; hit_count++; }
int script_active(void) { return busy; }
void script_start(const ScriptEvent *s) { run_count++; last_script = s; }
int script_thread_start(const ScriptEvent *s) { if (threads_full) return 0; thread_count++; last_script = s; return 1; }
int modes_player_visible(void) { return 1; }
void sprite_hide(ASprite *s) { s->visible = 0; }
void sprite_show(ASprite *s) { s->visible = 1; }
void entity_update_camera(Entity *e, int x, int y) { (void)e; (void)x; (void)y; }
int raycast_active(void) { return 0; }
int raycast_solid_at(int x, int y) { (void)x; (void)y; return 0; }
int collision_test_rect(int x, int y, int w, int h) { (void)x; (void)y; (void)w; (void)h; return 0; }
void entity_set_anim_state(Entity *e, int state) {
    if (e && e->def && state >= 0 && state < e->def->state_count) e->anim_state = state;
}
void entity_animate(Entity *e, Direction d, int moving) { (void)e; (void)d; (void)moving; }
int sprite_sin(int angle) { (void)angle; return 0; }
int16_t var_get(int index) { (void)index; return 0; }

static void projectile_checks(void)
{
    Entity shot_entity = player;
    shot_entity.x = npc.x;
    Projectile shot = { .e = &shot_entity, .active = 1, .source = -1,
        .landed = 1, .land = PROJ_LAND_LINGER, .target = 2, .group = 1,
        .x = npc.x << 8, .y = npc.y << 8 };
    memset(shots, 0, sizeof(shots));
    invincible_timer = 10; /* player invincibility must not protect actors */
    npc.collide = 0;
    shots[0] = shot;
    projectiles_update(1, 0, 0);
    assert(run_count == 1 && last_script == actor_script && hit_count == 0);
    projectiles_update(1, 0, 0);
    assert(run_count == 1); /* piercing/lingering hits each actor once */
    shots[0] = shot;
    shots[0].target = 4;
    projectiles_update(1, 0, 0);
    assert(run_count == 1); /* other group */
    shots[0] = shot;
    shots[0].source = 0;
    projectiles_update(1, 0, 0);
    assert(run_count == 1); /* source actor is excluded */
    shots[0] = shot;
    npc.solid = 0;
    projectiles_update(1, 0, 0);
    assert(run_count == 1); /* hidden actors cannot be hit */
    npc.solid = 1;
    shots[0] = shot;
    shots[0].landed = 0;
    shots[0].flags = PROJ_FLAG_ACTOR_BOUNCE | PROJ_FLAG_WALLS;
    shots[0].target = 0;
    shots[0].vx = 256;
    projectiles_update(1, 0, 0);
    assert(shots[0].vx == 256); /* non-solid actors do not bounce shots */
    npc.collide = 1;
    shots[0] = shot;
    shots[0].landed = 0;
    shots[0].flags = PROJ_FLAG_ACTOR_BOUNCE | PROJ_FLAG_WALLS;
    shots[0].target = 0;
    shots[0].vx = -256;
    shots[0].x += 256;
    projectiles_update(1, 0, 0);
    assert(shots[0].vx == 256); /* solid actor bounce is preserved */
    invincible_timer = 0;
    shots[0] = shot;
    shots[0].target = PROJ_TARGET_PLAYER;
    shots[0].group = 1;
    shot_entity.x = 0;
    shots[0].x = 0;
    projectiles_update(1, 0, 0);
    assert(hit_count == 1 && last_script == player_script);
}

static void reset(void)
{
    memset(&test_scene, 0, sizeof(test_scene));
    memset(&player, 0, sizeof(player));
    memset(&npc, 0, sizeof(npc));
    memset(&npc_def, 0, sizeof(npc_def));
    player.active = player.solid = player.collide = player.blocks_player = 1;
    player.col_w = player.col_h = player.width = player.height = 16;
    npc = player;
    npc.x = 16;
    g_player = &player;
    npc_count_active = 1;
    npc_entities[0] = &npc;
    npc_defs[0] = &npc_def;
    npc_touching[0] = 0;
    npc_def.collision_group = 1; npc.collision_group = 1;
    npc_def.on_hit = actor_script;
    for (int g = 0; g < 4; g++) npc_def.hit_groups[g] = actor_script;
    test_scene.player_hit[0] = player_script;
    mode_settings[MS_HIT_INVINCIBLE] = 10;
    invincible_timer = hit_count = run_count = thread_count = busy = threads_full = 0;
    last_script = 0;
}

static void fire_at_npc(Entity *e, int group, int targets)
{
    *e = npc;
    memset(shots, 0, sizeof(shots));
    shots[0] = (Projectile){ .e = e, .active = 1, .source = -1,
        .group = group, .target = targets, .flags = PROJ_FLAG_WALLS,
        .x = e->x << 8, .y = e->y << 8 };
}

static void combined_checks(void)
{
    static const ScriptEvent reactions[4][2] = {
        {{ .op = SCRIPT_WAIT, .a = 10 }, { .op = SCRIPT_END }},
        {{ .op = SCRIPT_WAIT, .a = 20 }, { .op = SCRIPT_END }},
        {{ .op = SCRIPT_WAIT, .a = 30 }, { .op = SCRIPT_END }},
        {{ .op = SCRIPT_WAIT, .a = 40 }, { .op = SCRIPT_END }},
    };
    Entity e;
    for (int member = 1; member <= 4; member++) {
        for (int incoming = 1; incoming <= 4; incoming++) {
            reset();
            npc_def.collision_group = member; npc.collision_group = member;
            for (int g = 0; g < 4; g++) npc_def.hit_groups[g] = reactions[g];
            test_scene.player_hit[member - 1] = player_script;
            check_npc_hits(&player);
            assert(hit_count == 1 && last_script == player_script);
            fire_at_npc(&e, incoming, 1 << member);
            projectiles_update(1, 0, 0);
            assert(hit_count == 1 && last_script == reactions[incoming - 1]);
            assert(run_count == 2 && !shots[0].active);
            actor_set_hit_response(0, 1 << incoming, 0);
            fire_at_npc(&e, incoming, 1 << member);
            projectiles_update(1, 0, 0);
            assert(run_count == 2 && shots[0].active && !shots[0].hit_npcs);
            assert(npc.collide && npc.solid && npc_def.hit_groups[incoming - 1] == reactions[incoming - 1]);
            actor_set_hit_response(0, 1 << incoming, 1);
            projectiles_update(1, 0, 0);
            assert(run_count == 3 && !shots[0].active);
            fire_at_npc(&e, incoming, 1 << (member == 4 ? 1 : member + 1));
            projectiles_update(1, 0, 0);
            assert(run_count == 3 && shots[0].active);
        }
    }
    /* Exercise the compiler's output through the runtime entry points. */
    reset();
    test_scene = *scenes[0];
    npc_def = test_scene.npcs[0];
    reset_npc_collision(&npc, &npc_def);
    assert(npc.hit_disabled == 19);
    check_npc_hits(&player);
    assert(hit_count == 0);
    fire_at_npc(&e, 4, 16);
    projectiles_update(1, 0, 0);
    assert(run_count == 0 && shots[0].active);
    const ScriptEvent *ev = test_scene.on_init;
    while (ev->op != SCRIPT_END && ev->op != SCRIPT_ACTOR_HIT_RESPONSE) ev++;
    assert(ev->op == SCRIPT_ACTOR_HIT_RESPONSE);
    actor_set_hit_response(ev->a, ev->b, ev->c);
    assert(npc.hit_disabled == 3); /* contact/group 1 remain disabled */
    projectiles_update(1, 0, 0);
    assert(run_count == 1 && last_script == npc_def.hit_groups[3] && !shots[0].active);
    actor_set_hit_response(0, 1, 1);
    check_npc_hits(&player);
    assert(hit_count == 1 && last_script == npc_def.on_player_hit);
    actor_set_hit_response(0, 1, 0);
    invincible_timer = 0;
    check_npc_hits(&player);
    assert(hit_count == 1);
    actor_set_hit_response(0, 1, 1);
    check_npc_hits(&player);
    assert(hit_count == 2); /* re-enable without moving out and back */
    ActorSnap snapshot;
    actor_set_hit_response(0, 31, 0);
    snap_actor(&snapshot, &npc);
    actor_set_hit_response(0, 31, 1);
    unsnap_actor(0, &npc, &snapshot);
    assert(npc.hit_disabled == 31);
    npc_def.spawn_pool = 1;
    npc_dormant[0] = 1;
    int16_t params[SPAWN_P_N] = {0};
    params[SPAWN_P_COUNT] = 1;
    assert(actor_spawn(params) == 0 && npc.hit_disabled == 19);
    reset();
    actor_set_hit_response(PLAYER_ACTOR_INDEX, 31, 0);
    check_npc_hits(&player);
    assert(hit_count == 0);
    fire_at_npc(&e, 1, PROJ_TARGET_PLAYER);
    shots[0].x = 0;
    projectiles_update(1, 0, 0);
    assert(hit_count == 0 && shots[0].active);
    actor_set_hit_response(PLAYER_ACTOR_INDEX, 2, 1);
    projectiles_update(1, 0, 0);
    assert(hit_count == 1 && !shots[0].active && player.hit_disabled == 29);
    reset();
    test_scene.player_hit[0] = empty_script;
    fire_at_npc(&e, 1, PROJ_TARGET_PLAYER);
    shots[0].x = 0;
    projectiles_update(1, 0, 0);
    assert(hit_count == 0 && shots[0].active);
    puts("Combined #1/#2/#3 group matrix, compiled controls, contact, pause and respawn checks passed.");
}

static void independence_and_pickup_checks(void)
{
    Entity e;
    reset();
    npc_def.on_interact = actor_script;
    assert(world_npc_solid(0) && world_npc_interact_script(0) == actor_script);
    actor_set_solid(0, 0);
    assert(!world_npc_solid(0) && npc.collide && world_npc_interact_script(0) == actor_script);
    fire_at_npc(&e, 1, 2);
    projectiles_update(1, 0, 0);
    assert(run_count == 1 && last_script == actor_script);
    npc.x = 15;
    check_npc_hits(&player);
    assert(hit_count == 1 && last_script == player_script);
    actor_set_interaction(0, 0);
    assert(!world_npc_interact_script(0) && world_npc_hit_script(0, 1) == actor_script);
    actor_set_solid(0, 1);
    assert(world_npc_solid(0) && !world_npc_interact_script(0));
    actor_set_interaction(0, 1);
    actor_set_hit_response(0, 31, 0);
    assert(world_npc_solid(0) && world_npc_interact_script(0) == actor_script);
    actor_set_collisions(0, 0);
    assert(!world_npc_solid(0) && world_npc_interact_script(0) == actor_script);
    actor_set_hit_response(0, 31, 1);
    assert(world_npc_hit_script(0, 1) == actor_script);
    actor_set_interaction(PLAYER_ACTOR_INDEX, 0);
    assert(!world_npc_interact_script(0));
    actor_set_interaction(PLAYER_ACTOR_INDEX, 1);
    assert(world_npc_interact_script(0) == actor_script);
    {
        Entity behind = npc;
        NpcDef behind_def = npc_def;
        behind_def.on_interact = player_script;
        behind.interaction_disabled = 0;
        npc_count_active = 2;
        npc_entities[1] = &behind;
        npc_defs[1] = &behind_def;
        npc.interaction_disabled = 1;
        player.direction = DIR_RIGHT;
        assert(world_npc_in_front(&player) == player_script);
        assert(world_npc_at(20, 8) == 1);
        npc_entities[1] = 0;
        npc_defs[1] = 0;
        npc_count_active = 1;
    }

    /* An actual compiled enemy handler becomes a harmless pickup. */
    reset();
    npc_def = scenes[0]->npcs[2];
    reset_npc_collision(&npc, &npc_def);
    npc_count_active = 3;
    npc_entities[0] = npc_entities[1] = 0;
    npc_defs[0] = npc_defs[1] = 0;
    npc_entities[2] = &npc;
    npc_defs[2] = &npc_def;
    npc.x = 15; /* touching the player before and after conversion */
    assert(world_npc_solid(2));
    fire_at_npc(&e, 4, 4);
    projectiles_update(1, 0, 0);
    assert(run_count == 1 && last_script == npc_def.hit_groups[3]);
    const ScriptEvent *convert = last_script;
    assert(convert->op == SCRIPT_ACTOR_COLLISION_GROUP && convert->a == 2);
    actor_set_collision_group(convert->a, convert->b);
    assert(npc.collision_group == 5 && npc.collide && !world_npc_solid(2));
    assert(world_npc_interact_script(2) == npc_def.on_interact);
    /* Old enemy scripts cannot make a pickup hurt or block the player. */
    actor_set_hit_response(2, 31, 1);
    actor_set_solid(2, 1);
    assert(!world_npc_solid(2) && !world_npc_hit_script(2, 4));
    fire_at_npc(&e, 4, 30);
    shots[0].flags |= PROJ_FLAG_ACTOR_BOUNCE;
    projectiles_update(1, 0, 0);
    assert(run_count == 1 && shots[0].active && !shots[0].hit_npcs);
    invincible_timer = 10;
    player.hit_disabled = 31; /* collecting is independent of combat controls */
    busy = threads_full = 1;
    check_npc_hits(&player);
    assert(!npc.pickup_collected && thread_count == 0 && hit_count == 0);
    threads_full = 0;
    check_npc_hits(&player);
    assert(npc.pickup_collected && thread_count == 1 && last_script == npc_def.on_collect);
    check_npc_hits(&player);
    assert(thread_count == 1 && hit_count == 0);
    npc.x = 64;
    check_npc_hits(&player);
    npc.x = 15;
    check_npc_hits(&player);
    assert(thread_count == 1); /* leaving and returning cannot duplicate rewards */
    actor_set_collision_group(2, 5);
    check_npc_hits(&player);
    assert(thread_count == 1); /* repeated Pickup assignments keep the latch */
    ActorSnap snap;
    snap_actor(&snap, &npc);
    actor_set_collision_group(2, 1);
    unsnap_actor(2, &npc, &snap);
    assert(npc.collision_group == 5 && npc.pickup_collected && !world_npc_solid(2));
    check_npc_hits(&player);
    assert(thread_count == 1);
    npc_def.spawn_pool = 1;
    const ScriptEvent *base;
    actor_remove(2, &base);
    int16_t params[SPAWN_P_N] = {0};
    params[SPAWN_P_FIRST] = 2;
    params[SPAWN_P_COUNT] = 1;
    assert(actor_spawn(params) == 2);
    assert(npc.collision_group == 2 && !npc.pickup_collected && npc.blocks_player);
    assert(world_npc_solid(2) && world_npc_hit_script(2, 4));

    reset();
    npc_def.on_collect = empty_script;
    actor_set_collision_group(0, 5);
    npc.x = 15;
    check_npc_hits(&player);
    assert(run_count == 0 && hit_count == 0 && !npc.pickup_collected);
    npc_def.on_collect = actor_script;
    npc.x = 16;
    check_npc_hits(&player);
    assert(run_count == 0); /* pickups require overlap, not blocking-edge reach */
    npc.x = 15;
    npc.pinned = 1;
    check_npc_hits(&player);
    assert(run_count == 0);
    npc.pinned = 0;
    npc.solid = 0;
    check_npc_hits(&player);
    assert(run_count == 0);
    npc.solid = 1;
    check_npc_hits(&player);
    assert(run_count == 1 && hit_count == 0);
    reset();
    npc_def.on_collect = actor_script;
    npc_def.collect_touch_disabled = 1;
    actor_set_collision_group(0, 5);
    npc.x = 15;
    check_npc_hits(&player);
    assert(!run_count && !npc.pickup_collected);
    busy = threads_full = 1;
    assert(actor_collect(0) == -1 && !npc.pickup_collected);
    threads_full = 0;
    npc.x = 64;
    assert(actor_collect(0) == 1 && npc.pickup_collected && last_script == actor_script);
    assert(actor_collect(0) == 0 && thread_count == 1);
    assert(actor_collect(PLAYER_ACTOR_INDEX) == 0);
    reset();
    npc_def = scenes[0]->npcs[3]; /* compiler-reserved manual-collection prefab pool */
    reset_npc_collision(&npc, &npc_def);
    npc_count_active = 4;
    for (int i = 0; i < 3; i++) { npc_entities[i] = 0; npc_defs[i] = 0; }
    npc_entities[3] = &npc;
    npc_defs[3] = &npc_def;
    npc.solid = 0;
    npc_dormant[3] = 1;
    const ScriptEvent *spawn = scenes[0]->on_init;
    while (spawn->op != SCRIPT_END && spawn->op != SCRIPT_SPAWN_PREFAB) spawn++;
    assert(spawn->op == SCRIPT_SPAWN_PREFAB && actor_spawn(spawn->ptr) == 3);
    player.x = npc.x;
    player.y = npc.y;
    check_npc_hits(&player);
    assert(!run_count && !npc.pickup_collected);
    const ScriptEvent *interact = world_npc_interact_script(3);
    assert(interact && interact->op == SCRIPT_ACTOR_COLLECT && interact->a == 3);
    assert(actor_collect(interact->a) == 1 && last_script == npc_def.on_collect);
    assert(actor_collect(interact->a) == 0 && run_count == 1 && !hit_count);
    puts("Combined #1-#5 independent collisions, enemy conversion and safe one-time pickup checks passed.");
}

static void custom_state_checks(void)
{
    reset();
    player.def = &sprite_defs[0];
    npc.def = &sprite_defs[1];
    player.hit_disabled = 8;
    npc.hit_disabled = 4;
    actor_set_state_name(PLAYER_ACTOR_INDEX, "attack");
    assert(player.anim_state == 1 && player.script_state == 2);
    actor_set_state_name(0, "attack");
    assert(npc.anim_state == 2 && !npc.script_state);
    actor_set_state_name(PLAYER_ACTOR_INDEX, "guard");
    assert(player.anim_state == 1 && player.script_state == 2); /* absent on current sheet */
    player.def = &sprite_defs[1]; /* completed sprite-sheet change */
    actor_set_state_name(PLAYER_ACTOR_INDEX, "guard");
    assert(player.anim_state == 3 && player.script_state == 4);
    actor_set_state_name(PLAYER_ACTOR_INDEX, "attack");
    assert(player.anim_state == 2 && player.script_state == 3);
    actor_set_state_name(PLAYER_ACTOR_INDEX, sprite_defs[1].state_names[4]);
    assert(player.anim_state == 4 && player.script_state == 5);
    actor_set_state_name(PLAYER_ACTOR_INDEX, "missing");
    actor_set_state(PLAYER_ACTOR_INDEX, 1000);
    assert(player.anim_state == 4 && player.script_state == 5);
    actor_set_state(PLAYER_ACTOR_INDEX, 0);
    assert(!player.anim_state && !player.script_state);
    assert(player.hit_disabled == 8 && npc.hit_disabled == 4 && npc.blocks_player && npc.collision_group == 1);
    actor_set_collision_group(0, 5);
    actor_set_state_name(0, "attack");
    assert(npc.anim_state == 2 && npc.collision_group == 5 && !world_npc_solid(0));
    assert(!world_npc_hit_script(0, 1));
    actor_set_state_name(-99, "attack");
    puts("Named states follow current actor/player sheets without changing combat or pickup state.");
}

int main(void)
{
    combined_checks();
    independence_and_pickup_checks();
    custom_state_checks();
    reset();
    npc_def.on_player_hit = actor_script;
    check_npc_hits(&player);
    assert(hit_count == 1 && last_script == actor_script);
    reset();
    npc_def.on_player_hit = empty_script;
    check_npc_hits(&player);
    assert(hit_count == 0 && invincible_timer == 0);
    reset();
    npc_def.player_hit_disabled = 1;
    npc.hit_disabled = 1;
    npc_def.on_player_hit = actor_script;
    check_npc_hits(&player);
    assert(hit_count == 0);
    reset();
    npc_def.collision_group = 4; npc.collision_group = 4;
    test_scene.player_hit[3] = player_script;
    check_npc_hits(&player);
    assert(hit_count == 1 && last_script == player_script);
    reset();
    {
        Entity shot_entity = npc;
        Projectile shot = { .e = &shot_entity, .active = 1, .source = -1,
            .landed = 1, .land = PROJ_LAND_LINGER, .target = 2,
            .x = npc.x << 8, .y = npc.y << 8 };
        for (int g = 1; g <= 4; g++) {
            memset(shots, 0, sizeof(shots));
            shot.group = g;
            shots[0] = shot;
            npc_def.hit_groups[g - 1] = player_script;
            projectiles_update(1, 0, 0);
            assert(run_count == g && last_script == player_script && hit_count == 0);
            npc_def.hit_groups[g - 1] = 0;
        }
        shots[0] = shot;
        shots[0].landed = 0;
        shots[0].flags = PROJ_FLAG_WALLS;
        shots[0].group = 4;
        projectiles_update(1, 0, 0);
        assert(run_count == 4 && shots[0].active && !shots[0].hit_npcs);
        npc_def.hit_groups[3] = empty_script;
        projectiles_update(1, 0, 0);
        assert(run_count == 4 && shots[0].active && !shots[0].hit_npcs);
        npc_def.hit_groups[3] = actor_script;
        npc_def.collision_group = 4; npc.collision_group = 4;
        shots[0].target = 16;
        projectiles_update(1, 0, 0);
        assert(run_count == 5 && last_script == actor_script && !shots[0].active);
        shot_entity.x = 0;
        shots[0] = shot;
        shots[0].x = 0;
        shots[0].target = PROJ_TARGET_PLAYER;
        shots[0].group = 4;
        test_scene.player_hit[3] = player_script;
        projectiles_update(1, 0, 0);
        assert(hit_count == 1 && last_script == player_script);
        assert(!world_npc_hit_script(0, 0) && !world_npc_hit_script(0, 5));
    }
    reset();
    check_npc_hits(&player);
    assert(hit_count == 1 && last_script == player_script && invincible_timer == 10);
    check_npc_hits(&player);
    assert(hit_count == 1);
    npc.x = 80;
    check_npc_hits(&player);
    invincible_timer = 0;
    npc.x = 16;
    check_npc_hits(&player);
    assert(hit_count == 2); /* leaving and re-entering permits another hit */
    reset();
    test_scene.player_hit[0] = 0;
    check_npc_hits(&player);
    assert(hit_count == 0 && run_count == 0 && invincible_timer == 0);
    world_player_hit(empty_script, 0, 0);
    assert(hit_count == 0 && invincible_timer == 0);
    world_player_hit(player_script, 0, 0);
    assert(hit_count == 1);
    world_player_hit(player_script, 0, 0);
    assert(hit_count == 1);
    reset();
    busy = 1;
    check_npc_hits(&player);
    assert(run_count == 0 && thread_count == 1 && last_script == player_script);
    reset();
    npc.collide = 0;
    assert(world_npc_active(0) && !world_npc_solid(0));
    check_npc_hits(&player);
    assert(hit_count == 0);
    npc.x = 15;
    check_npc_hits(&player);
    assert(hit_count == 1);
    reset();
    npc.col_ox = 8;
    check_npc_hits(&player);
    assert(hit_count == 0);
    npc.x = 8;
    check_npc_hits(&player);
    assert(hit_count == 1);
    reset();
    npc.pinned = 1;
    check_npc_hits(&player);
    assert(hit_count == 0 && !world_npc_active(0));
    npc.pinned = 0; npc.solid = 0;
    check_npc_hits(&player);
    assert(hit_count == 0 && !world_npc_active(0));
    npc.solid = 1; npc.active = 0;
    check_npc_hits(&player);
    assert(hit_count == 0 && !world_npc_active(0));
    reset();
    npc_def.platform = 1;
    check_npc_hits(&player);
    assert(hit_count == 0);
    reset();
    npc_def.collision_group = 0; npc.collision_group = 0;
    check_npc_hits(&player);
    assert(hit_count == 0);
    npc_def.collision_group = 255; npc.collision_group = 255;
    check_npc_hits(&player);
    assert(hit_count == 0);
    reset();
    player.solid = 0;
    check_npc_hits(&player);
    world_player_hit(player_script, 0, 0);
    assert(hit_count == 0);
    reset();
    npc_def.collision_group = 3; npc.collision_group = 3;
    test_scene.player_hit[2] = player_script;
    check_npc_hits(&player);
    assert(hit_count == 1 && last_script == player_script);
    assert(!world_npc_active(-1) && !world_npc_active(NPC_MAX));
    reset();
    projectile_checks();
    puts("Player/actor contact and projectile regression checks passed.");
    return 0;
}
