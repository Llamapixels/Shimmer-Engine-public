// Run with: node tests/test_script_refs.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("../editor/node_modules/typescript");
require.extensions[".ts"] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  module._compile(outputText, filename);
};
const refs = require("../editor/src/script/scriptRefs.ts");
const model = require("../editor/src/script/customScriptModel.ts");
assert.equal(model.nextActorInputName([]), "actorA");
assert.equal(model.nextActorInputName([{ name: "actorA", kind: "variable" }]), "actorB");
const alphabet = Array.from({ length: 26 }, (_, i) => ({ name: `actor${String.fromCharCode(65 + i)}`, kind: "actor" }));
assert.equal(model.nextActorInputName(alphabet), "actor27");
const names = model.projectStateNames([
  { name: "first", states: [{ name: "" }, { name: "attack" }, { name: "guard" }] },
  { name: "second", states: [{ name: "attack" }, { name: "second_only" }, { name: "Default" }] },
]);
assert.deepEqual(new Set(names), new Set(["attack", "guard", "second_only"]));
const keys = ["on_player_hit", "on_hit_1", "on_hit_2", "on_hit_3", "on_hit_4", "on_collect"];
const script = () => [{ type: "set_var", var: "hp", value: 1 }];
const actor = Object.fromEntries(keys.map((key) => [key, script()]));
const scene = { background: "", npcs: [{ x: 0, y: 0, ...actor }], on_player_hit: { "4": script() } };
assert.equal(refs.sceneScripts(scene).filter(Boolean).length, 7);
const renamed = refs.renameRefsInScene(scene, "variable", "hp", "health");
for (const key of keys) {
  assert.equal(renamed.npcs[0][key][0].var, "health");
  assert.equal(scene.npcs[0][key][0].var, "hp");
}
assert.equal(renamed.on_player_hit["4"][0].var, "health");
const prefab = { id: "enemy", kind: "npc", template: actor };
const changed = refs.renameRefsInPrefab(prefab, "variable", "hp", "health");
for (const key of keys) assert.equal(changed.template[key][0].var, "health");
assert.equal(refs.prefabScripts(prefab).filter((s) => s.script).length, 6);
assert.equal(refs.labeledScripts(scene).filter((s) => s.script).length, 7);
const controls = { background: "", npcs: [{ x: 0, y: 0, name: "enemy", on_hit_4: [
  { type: "actor_set_hit_response", actor: "enemy", response: "group4", enabled: false },
  { type: "actor_set_solid", actor: "enemy", enabled: false },
  { type: "actor_set_interaction", actor: "enemy", enabled: true },
  { type: "actor_set_collision_group", actor: "enemy", group: "pickup" },
  { type: "actor_collect", actor: "enemy" },
] }] };
const renamedActor = refs.renameRefsInScene(controls, "actor", "enemy", "boss");
for (const ev of renamedActor.npcs[0].on_hit_4) assert.equal(ev.actor, "boss");
assert.equal(controls.npcs[0].on_hit_4[0].actor, "enemy");
console.log("New actor and scene scripts participate in reference discovery and renaming.");
