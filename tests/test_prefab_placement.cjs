const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("../editor/node_modules/typescript");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, filename);
};
global.localStorage = { getItem: () => null, setItem: () => {} };
const writes = [];
global.window = { api: {
  saveScene: async (value) => { writes.push(value); return { ok: true }; },
  saveProject: async () => ({ ok: true }),
} };
const { prefabCopy, prefabDropTile } = require("../editor/src/world/prefabs.ts");
const actor = { id: "coin", name: "Items/Coin", kind: "npc", template: {
  collision_group: 5, on_collect: [{ type: "actor_remove", actor: "self" }],
} };
const trigger = { id: "door", name: "Door", kind: "door", template: { width: 3, height: 2 } };
for (const scale of [0.1, 0.5, 1, 2, 8]) {
  const bounds = { left: 70, top: 90, width: 240 * scale, height: 160 * scale };
  assert.deepEqual(prefabDropTile({ clientX: 70 + 40 * scale, clientY: 90 + 24 * scale }, bounds, 30, 20, actor), { x: 5, y: 3 });
  assert.deepEqual(prefabDropTile({ clientX: 70 + 239 * scale, clientY: 90 + 159 * scale }, bounds, 30, 20, actor), { x: 28, y: 18 });
  assert.deepEqual(prefabDropTile({ clientX: 70 + 239 * scale, clientY: 90 + 159 * scale }, bounds, 30, 20, trigger), { x: 27, y: 18 });
  assert.equal(prefabDropTile({ clientX: 69, clientY: 90 }, bounds, 30, 20, actor), null);
}
const copy = prefabCopy(actor, {}, 1, 2, "hero");
assert.equal(copy.value.sprite, "hero");
copy.value.on_collect[0].actor = "other";
assert.equal(actor.template.on_collect[0].actor, "self");
const { useProjectStore: store } = require("../editor/src/state/projectStore.ts");
const original = { rootPath: "mock", project: { name: "Test", start_scene: "map", playerSprite: "hero", prefabs: [actor, trigger] },
  scenes: [{ fileId: "map", data: { name: "map", background: "map.png", world_pos: { x: 40, y: 80 }, player_start: { x: 4, y: 5 }, npcs: [] } }] };
store.setState({ project: original, activeSceneId: "map", past: [], future: [], selection: { kind: "prefab", id: "coin" } });
assert.equal(store.getState().placePrefab("missing", "coin", 1, 2), false);
assert.equal(store.getState().placePrefab("map", "coin", 1, 2), true);
assert.equal(store.getState().placePrefab("map", "coin", 3, 4), true);
let scene = store.getState().project.scenes[0].data;
assert.deepEqual(scene.npcs.map((n) => n.name), ["Coin", "Coin_2"]);
assert.deepEqual(scene.world_pos, { x: 40, y: 80 });
assert.equal(scene.npcs[0].collision_group, 5);
assert.deepEqual(store.getState().selection, { kind: "npc", sceneId: "map", index: 1 });
store.getState().undo();
assert.equal(store.getState().project.scenes[0].data.npcs.length, 1);
store.getState().redo();
assert.equal(store.getState().project.scenes[0].data.npcs.length, 2);
assert.equal(store.getState().placePrefab("map", "door", 6, 7), true);
assert.deepEqual(store.getState().project.scenes[0].data.doors[0], { width: 3, height: 2, x: 6, y: 7 });
store.getState().addPrefabSpawn("map", "coin");
assert.deepEqual(store.getState().project.scenes[0].data.on_init[0], { type: "spawn_prefab", prefab: "coin", max: 1, at: "tile", x: 4, y: 5 });
assert.equal(store.getState().selection.kind, "scene");
store.getState().addPrefabSpawn("map", "door");
assert.equal(store.getState().project.scenes[0].data.on_init.length, 1);
store.getState().updateScene("map", (s) => ({ ...s, npcs: Array.from({ length: 16 }, (_, i) => ({ x: i, y: 0 })) }));
assert.equal(store.getState().placePrefab("map", "coin", 1, 2), false);
assert.equal(store.getState().project.scenes[0].data.npcs.length, 16);
assert.match(store.getState().error, /16 actors/);
const initBeforeLimit = store.getState().project.scenes[0].data.on_init;
store.getState().addPrefabSpawn("map", "coin");
assert.equal(store.getState().project.scenes[0].data.on_init, initBeforeLimit);
assert.ok(writes.length);
console.log("Prefab drops at five zoom levels, independent copies, unique names, undo/redo, triggers, spawn scripts and limits passed.");
