# Technical change log

## 2026-10-30 — Separate player damage from actor hits

### Findings

Traced the editor's scene/player and actor script tabs through JSON types, Python script compilation, the main runtime contact checks, projectile processing and platformer movement/interaction.

- `check_npc_hits()` preferred an actor's `on_hit` over the scene's `player_hit` handler, making enemy-hit scripts also run on player contact.
- `world_player_hit()` applied knockback and invincibility even when its script pointer was null.
- Projectile damage and platformer interaction used `world_npc_solid()`, excluding actors whose movement collisions were disabled.

### Implementation

- `engine/source/main.c`: contact dispatches exclusively to the matching scene player-hit handler. Missing handlers and END-only compiled scripts produce no player damage effects. Hidden/inactive players are excluded. Contact group bounds are checked before indexing. Solid actors retain edge contact; non-solid actors require actual collision-box overlap.
- Added `world_npc_active()` for visible, active, unpinned actors. The existing `solid` field represents visibility/participation; `collide` controls movement blocking. `world_npc_solid()` combines participation with movement collisions.
- `engine/source/projectile.c`: damage uses actor participation independently of movement solidity. Bouncing still requires solidity. Source exclusion, group targeting and per-projectile actor-hit tracking are preserved.
- `engine/source/modes.c`: platformer interaction uses participation, allowing non-solid actors to talk while keeping the movement-blocking path separate.
- Updated inspector hints, JSON type comments and compiler format documentation. No event opcodes, struct layouts or project schemas changed.
- Added host C regression harnesses that include the actual runtime sources. Script dispatch, knockback and hardware dependencies are stubbed; the contact, projectile and interaction logic runs directly. The runner generates current mode-setting constants rather than changing checked-in generated data.
- Added a small two-actor project fixture for ROM compilation and manual testing.

### Validation

- `python tests/run_native.py --cc C:/msys64/mingw64/bin/gcc.exe`: passed. Covers distinct actor/player handlers, null and END-only handlers, invincibility, background dispatch, contact re-entry, authored hitbox offsets, non-solid overlap, hidden/inactive/pinned actors, platform exclusions, group bounds, projectile targeting/source exclusion, repeat-hit suppression, player-projectile hits, solid-only bouncing, and platformer interaction versus movement blocking.
- `npm run typecheck` in `editor`: passed for renderer and Electron.
- `python compiler/build_rom.py tests/fixtures/hit_detection --devkitpro editor/toolchain-bundle/devkitpro`: passed, compiling and linking the full engine into a GBA ROM with two actors and separate actor/player handlers.
- `git diff --check`: passed.

### Compatibility and limits

Contact scripts that previously lived in actor `on_hit` must move to the appropriate scene/player `on_player_hit` handler. This intentional behavior change is documented in `CHANGELOG.md`.

Existing edge-triggered contact behavior, platform contact exclusions, three collision groups and projectile lifetime/consumption rules remain. This change does not add per-group actor tabs or a fourth collision group. No emulator or physical GBA playthrough was performed; compilation and host regressions do not verify the complete interactive game loop or visuals.

Pre-existing changes in `engine/data/` and the user's game/assets were left untouched.

## 2026-10-30 — Separate actor contact and projectile-group tabs (#2)

### Design and reference

Reviewed the local GB Studio compiler's actor `combineScripts` dispatch in `gb-studio-source/src/lib/compiler/compileData.ts` (incoming hit groups select separate scripts). Implemented dispatch in Shimmer's own C runtime and Python data compiler; no GB/GBC VM implementation was copied.

Actor collision-group membership remains the projectile target filter. The projectile's own group selects the receiving actor's script. This supports, for example, different weapon reactions on the same enemy without changing which actor groups the weapon targets.

### Changes

- Added optional NPC/prefab JSON scripts `on_hit_1` through `on_hit_4`, `on_player_hit`, and boolean `player_hit_enabled`.
- Missing per-group fields inherit legacy `on_hit`. Explicit empty lists compile to null handlers and suppress that fallback. Runtime damage requires a nonempty handler, so empty groups neither run scripts nor consume projectiles. Solid-actor bounce behavior remains independent.
- Missing actor `on_player_hit` inherits the scene's group handler. Explicit [] compiles to an END-only script to distinguish opting out from inheritance. `player_hit_enabled: false` disables contact damage while preserving the authored script.
- Actor scripts compile with the owning actor as Self. The existing scene/player fallback keeps its original scope. Contact invincibility and edge-trigger behavior remain intact.
- Extended actor and scene C data with four hit-group pointers, actor contact overrides and a disabled flag; scene player-hit arrays now have four entries. Updated all compiler initializers, target masks, projectile group bounds and mode setting choices. No event opcodes changed. Generated data must be rebuilt with the matching engine.
- Added `world_npc_hit_script()` and used it for projectile dispatch and First Person 3D shooting (group 1). Projectiles still exclude their source and retain existing per-actor hit suppression.
- Updated actor and prefab inspectors with distinct tabs, handler inheritance controls, player-contact enable switches and counts. Long tab sets wrap within the inspector.
- Updated scene script traversal, renaming, prefab traversal, labeled reference lists and world-map connections. Existing dialogue tools use those shared traversals.
- Retained pre-existing generated-data and game changes.

### Validation

- Native runtime regressions passed for actor contact override/inheritance/disable/empty handlers, all four incoming projectile groups, independent target filtering, empty handlers not consuming shots, group 4 player hits and previous collision regressions.
- Generated-data C checks passed for legacy fallback pointers, explicit empty overrides, actor Self indices, actor contact flags, scene group 4 handlers and group 4 projectile group/target operands.
- `node tests/test_script_refs.cjs`: passed for new actor scripts and scene group 4 reference enumeration, labels and immutable renaming, including prefabs.
- Editor renderer/Electron type checks and production build passed. Vite reported its existing CJS API deprecation and large-bundle advisory.
- Full ARM compilation/link passed for the original compatibility fixture and the generated project variant with the new actor fields and group 4. Native outputs and variant builds are under ignored `tests/build/`.
- `git diff --check`: passed. No emulator or hardware playthrough was performed; interactive layout and full game-loop behavior still need playtesting.

## 2026-10-31 — Damage response controls and combined validation (#3)

### Scope and implementation

The incoming-group dispatch and separate projectile target filter were introduced with #2. This change completes configurable damage interactions and validates them with the player-contact behavior from #1 and the actor handlers from #2.

- Added optional NPC/prefab `hit_1_enabled` through `hit_4_enabled` fields, defaulting to true. Each group tab now exposes its enable switch without removing its script. The compiler validates booleans and packs defaults into `NpcDef.projectile_hit_disabled`.
- Added a runtime `Entity.hit_disabled` mask: bit 0 gates actor contact, bits 1–4 gate incoming hit groups. NPC defaults combine the existing player-contact setting with the new per-group flags. Entity creation, scene entry and prefab respawn initialize the mask; sprite changes do not reset it.
- Added **Set Actor Hit Response** (`actor_set_hit_response`) with Contact, Group 1–4 and All choices. The compiler emits actor index, response mask and enabled value. Appended `SCRIPT_ACTOR_HIT_RESPONSE` to preserve existing opcode numbers; `script.c` dispatches it to `actor_set_hit_response()`.
- The event supports NPCs and Player. NPC groups gate `world_npc_hit_script()`. Player groups gate projectile hits, damage tiles and shoot-em-up wall hits. Contact is independent of incoming projectile groups and movement collisions. Empty handlers remain inactive even after enabling them.
- Changing a contact response resets its contact-edge latch. Repeating an unchanged setting does not create new contact edges. Invincibility still applies when a handler is re-enabled.
- Damage-disabled actor/player hits do not consume a projectile or mark an actor as already hit, so a still-overlapping projectile can hit after re-enabling. Empty player projectile handlers now also leave projectiles untouched. Solid-actor bounce behavior remains independent.
- Real-pause `ActorSnap` capture/restore now preserves the mask. Respawn uses authored defaults so pooled actors do not inherit an earlier instance's disabled responses.
- Added group bounds checks to damage-tile and shoot-em-up wall-hit dispatch. Existing player/actor script separation and legacy handler inheritance are retained.
- Existing user game/assets and previously modified `engine/data/` files were left untouched; builds use isolated test output folders.

### Combined validation

- Native C tests run actual engine contact, projectile and response-control functions for all 16 actor-target-group/incoming-projectile-group combinations. They verify handler selection, wrong-target exclusion, disabling/re-enabling individual groups, preserving scripts and solidity, projectile consumption only on active handlers, and player-contact independence during invincibility.
- Generated project C data is included in the runtime harness: authored disabled defaults and group 4 handlers are loaded, a compiled response-control instruction's operands are applied through the runtime API, and the same projectile resumes hitting after enabling. Contact overrides, contact re-enable while touching, snapshot restoration and prefab respawn defaults are also checked.
- Native tests retain previous #1/#2 checks for empty handlers, hidden/pinned/inactive actors, non-solid interaction, legacy pointers, actor Self compilation, group 4 launch operands and source exclusion. Player response masking and empty player projectile handlers are covered.
- `node tests/test_script_refs.cjs`: passed, including actor-reference renaming inside the new event and new group handlers.
- Editor TypeScript checks and renderer/Electron production build passed. Vite retains the existing CJS deprecation and large-bundle advisories.
- Full GBA ROM builds passed for both the original compatibility fixture and the new-controls/group-4 project variant, including the production script interpreter.

Host tests stub script scheduling, knockback and hardware rendering. The compiled-instruction integration test applies operands via the runtime API; it does not execute the full interpreter in the host harness. Full interactive gameplay, hardware timing and UI layout have not been emulator- or device-playtested.

## 2026-10-31 — Independent solidity/interaction and safe enemy pickups (#4–#5)

### Runtime and data changes

- Added independent `Entity.blocks_player`, `interaction_disabled`, mutable `collision_group`, and `pickup_collected` state. The legacy `Entity.solid` field still means presence/visibility; it was not repurposed. Hitbox offsets and dimensions are unchanged.
- Added optional NPC/prefab `solid`, `collisions`, `interact_enabled`, and `on_collect` JSON fields. Added matching compiled settings to `NpcDef`; compiler initializers and entity creation/scene entry/prefab respawn initialize the new state.
- `world_npc_solid()` combines presence, the existing movement collision switch, the independent blocking flag and exclusion of Pickup. Non-solid actors retain tile collision when the master movement switch is enabled. The existing Set Actor Collisions event remains compatible: disabling it bypasses both tiles and actor blocking.
- Platformer Auto solidity defaults to `platform`; other scenes default to solid. An explicit `solid` boolean overrides the default. This intentionally fixes unchecked Platform actors unexpectedly blocking the player; existing platformer games needing full blockers must select Solid explicitly.
- Added `world_npc_interact_script()` and routed top-down, platformer, First Person 3D and point-and-click actor interactions through it. Interaction checks ignore solidity and damage controls. Empty/disabled/non-present actors do not swallow another interactable actor behind them. Player interaction disabling gates actor interaction, not pickup collection.
- Appended three opcodes, preserving previous numbers: `SCRIPT_ACTOR_SET_SOLID`, `SCRIPT_ACTOR_SET_INTERACTION`, and `SCRIPT_ACTOR_COLLISION_GROUP`. Added compiler, JSON types, catalog entries, runtime APIs and interpreter dispatch. Collision-group membership events reject Player at compile time; solidity and interaction controls support Player.
- Combat target membership now reads the entity's mutable group. Incoming projectile groups and target masks remain groups 1–4. Dedicated membership 5 (`ACTOR_GROUP_PICKUP`) is reserved for harmless pickups; it is not a fifth projectile/weapon group.
- Switching an NPC to Pickup immediately clears player blocking and disables its combat responses. Pickup membership additionally guards contact, projectile/hitscan handlers and solid-actor bouncing, so merely re-enabling old damage flags or solidity cannot make it harmful again. Scripts, tile collision, gravity, interaction and existing On Update behavior are preserved. Returning to combat requires changing membership and explicitly enabling desired responses/solidity.
- On Collect dispatch uses exact collision-box overlap and bypasses combat invincibility. The actor is latched before dispatch to prevent duplicate scheduling/rewards, including after leaving/re-entering contact. Empty handlers do not latch. Repeating the same group assignment preserves the latch; changing groups or respawning starts a fresh instance.
- `world_run_script()` now returns scheduling success. Failed collection scheduling clears the latch so thread exhaustion cannot permanently lose a pickup. Other callers can continue ignoring the return value.
- Scene-stack snapshots preserve new collision/interaction/membership/collection state. Pooled respawn restores authored defaults. Moving-platform carry checks now verify that both the player and supporting actor still permit blocking, preventing an old platform reference carrying the player after pickup conversion or disabling solidity.
- Added actor/prefab inspector settings, safe Pickup membership, On Collect tabs and usage hints. Extended scene/prefab reference enumeration, immutable renaming, labeled scripts and world-map connections to include On Collect. Existing dialogue tools inherit that traversal support.

### Combined validation for #1–#5

- `python tests/run_native.py --cc C:/msys64/mingw64/bin/gcc.exe`: passed. Retains all sixteen combat target/incoming-group combinations and #1–#3 regressions, plus independent solidity/interaction/hits, interaction through a disabled actor, and player interaction controls.
- The compiled-data/runtime integration converts an actual compiled enemy through its group-change instruction operands, checks that the same actor becomes harmless while overlapping the player, resists stale damage/solidity re-enabling, ignores all combat projectile targets and bounces, schedules its compiled reward/removal script once, retries when threads were full, and preserves its latch on repeat contact and pause restoration. Respawn restores its original enemy group and blocking settings.
- Generated C assertions check pickup conversion and collection opcodes, Self actor indices, independent authored settings, platformer Auto defaults, explicit solid/non-solid overrides, movement/interaction disable flags and initial pickup membership.
- Platformer movement helper tests check one-way landing, explicit non-solid platforms, pickup exclusions and a non-solid player. Entity-source tests verify non-solid actors and pickups still consult tile collision, and recycled entity slots clear the new state.
- `node tests/test_script_refs.cjs`: passed for On Collect discovery/labels, scene and prefab renaming, and actor-reference renaming in all new events.
- Renderer/Electron type checks and production build passed. Vite reported the existing CJS deprecation and bundle-size advisories.
- Full ARM engine/interpreter compilation and ROM links passed for both the old-format compatibility fixture and the two-scene integration variant containing combat groups, pickup conversion, collection scripts and platformer settings.
- `git diff --check`: passed. Pre-existing game/assets and generated `engine/data/` modifications remain untouched.

### Limits and compatibility

The host harness exercises actual engine collision/state functions but stubs scheduling, reward execution, rendering and hardware timing. It verifies that the reward/removal script is compiled correctly and scheduled once, rather than executing the complete production interpreter in the host. No interactive emulator/device playthrough or visual UI inspection was performed.

On Collect intentionally runs once per actor instance; authors should remove the pickup in that script after awarding its reward. A script can deliberately reset collection by changing membership away from Pickup and back. Collection and interaction remain distinct. Default blocking changes only for platformer Auto actors; explicitly choose Solid where old all-sided blocking is required.

## 2026-10-31 — Custom-script states and actor inputs (#6–#7)

### Findings and implementation

Existing custom script `params`/`args` already supported actor inputs and inline substitution, including nested calls. The actor input UI was easy to miss, and animation state authoring/compilation still assumed a specific scene actor and its starting sprite sheet. That caused scene-independent state lists to be incomplete and alternate-player state names to fail compilation or point at the wrong local state index after a swap.

- Added `customScriptModel.ts` helpers for project-wide state names and nonconflicting actor input names (`actorA` through `actorZ`, then numbered names). Input naming avoids all existing parameter names, regardless of parameter kind.
- Custom script actor fields and the Inputs panel now expose **+ Actor input**. It reuses the existing `setCustomScriptParams()` path and schema, then selects the new `@actorA` reference in the edited event. Every Call Script already renders binding controls for that input; scene actor names, indices, Player, Self and outer custom-script actor inputs remain supported.
- Replaced the scene-only state selector with a project-wide named-state selector. Empty/default values select Default; existing numeric values remain numeric rather than being silently rewritten as string state names. JSON-encoded option values distinguish numbers from names safely.
- Named non-default `actor_set_state` events now compile to appended `SCRIPT_ACTOR_SET_STATE_NAME` instructions containing the resolved actor operand and UTF-8 state name. Typos unknown anywhere in the project remain compile errors. Default and numeric events keep the existing numeric opcode and validation.
- The sprite compiler emits an ordered state-name table per sprite and appends its pointer to `SpriteDef`. Runtime `actor_set_state_name()` searches the target entity's current sprite metadata, then uses the existing state setter. Missing current-sheet states are no-ops without changing player state ownership. State names are compared exactly; Default is the existing special alias for index 0.
- The normal state setter now validates range before writing the player's `script_state`, so an invalid index cannot leave movement animation ownership latched incorrectly.
- Name tables and instruction strings use matching UTF-8 bytes and safe C escaping. Tests include quote, backslash and non-ASCII characters. Sprite state names with embedded null characters are rejected because runtime names are C strings.
- No project schema changes, actor identity changes, collision-box changes or modifications to #1–#5 damage/pickup controls were introduced by this step. The sprite data layout and new opcode require a ROM rebuild with the matching compiler/runtime.
- Existing user game/assets and generated `engine/data/` modifications were left untouched.

### Validation

- `python tests/test_custom_scripts.py`: four tests with subcases passed. Covers bindings to named actors, numeric indices, Self and Player; known states absent from the initial player sheet; rejected missing/wrong actor inputs, invalid states and indices; Default and numeric compatibility.
- `node tests/test_script_refs.cjs`: passed, including project-wide unique state choices, actor input names across A–Z, existing-name collisions, and the earlier scene/prefab reference tests.
- `python tests/run_native.py --cc C:/msys64/mingw64/bin/gcc.exe`: passed. Generated C checks cover scene-init and actor-init calls, nested actor input substitution, different sheet state orders, a state available only on an alternate player sheet, sprite-change/state instruction order, Default, and escaped UTF-8 state-name equality.
- Runtime actor API checks resolve the same name to different current-sheet indices, preserve the current animation/ownership for a missing name, release player script ownership on Default, reject invalid indices, and preserve hit-response, collision-group and pickup safety state. Entity-source checks exercise the actual per-state animation-map selection with generated sprite metadata.
- All #1–#5 collision, group-matrix, pickup, pause, respawn and terrain regressions still pass.
- Renderer/Electron type checks and production build passed; existing Vite CJS/bundle-size advisories remain. Full ARM ROM builds passed for the expanded integration project and the legacy-format compatibility fixture.

The host actor API test models an already-completed sheet swap by assigning the compiled current-sheet definition. It checks actual name lookup and ownership logic; frame rendering and complete sprite-allocation/interpreter flow are not executed in that harness. Production animation-map logic is tested separately, and the complete runtime/interpreter compiles into both ROMs. No emulator/device playthrough or interactive UI inspection was performed.

## 2026-10-31 — Discoverable collection, explicit collection event and prefab placement

### Findings and changes

The existing Pickup membership triggered On Collect on overlap, but that prerequisite was hidden in collision settings. Prefab placement used a button below the long script editor and only the individual scene canvas handled its placement tool. Spawn Prefab already existed, but was not exposed from prefab properties. Sidebar prefab rows did not support map drag-and-drop.

- Added a pickup setup panel in On Collect for both actors and prefabs: one-click Pickup membership, a Collect on touch switch, and instructions for reward/removal and interaction-based collection.
- Added optional `collect_on_touch` (default true), compiled to `NpcDef.collect_touch_disabled`. Authored defaults survive prefab copying and compiler spawn-pool expansion. The default behavior of existing pickups is preserved.
- Added `actor_collect()` and appended `SCRIPT_ACTOR_COLLECT`, with compiler/type/catalog/interpreter support. It accepts only present Pickup actors with a nonempty On Collect handler and an unset collection latch. It uses the same one-time scheduling path as automatic collection; explicit script calls intentionally do not require overlap because their calling script controls the condition.
- Collection returns a retry status if scheduling fails. The interpreter retries the instruction on a later update instead of losing the reward; automatic collection also remains pending. Already-collected actors, empty handlers, combat actors, Player, hidden actors and pinned actors remain noncollectable through this API. No damage or combat-state side effects were added.
- Made prefab actions visible before the template/script fields; selecting a different prefab creates a fresh properties container so an old scroll offset does not hide the top actions. Sidebar rows expose Place and native drag-and-drop with a dedicated prefab MIME type.
- Added drag targets to SceneCanvas and WorldMap scene cards. A shared coordinate helper uses rendered bounds to handle zoom/scroll and clamps actor/trigger footprints to scene edges. World-map click placement now intercepts placement before scene movement/actor selection, with a cancel action and Escape support.
- Added `prefabCopy()` for deep-independent template copies and unique, nonreserved actor names. `placePrefab()` validates the destination, reports static actor limits, selects the actual placed item and preserves world scene positions. Undo/redo and autosave use the existing scene mutation path.
- Added `addPrefabSpawn()` and the top-level actor-prefab shortcut. It appends a standard Spawn Prefab event to the active scene On Init at its player-start tile, selects that scene for editing and starts with max 1. Trigger prefabs are excluded; a known full 16-actor scene is rejected. The compiler still validates the full hidden-pool budget.
- No user game files were edited for testing. UI work used a disposable `tests/build/prefab-ui-test` project; automated store tests mock persistence.

### Validation

- `node tests/test_prefab_placement.cjs`: passed for drops at five zoom levels, actor and trigger edge clamping, independent nested scripts, default player sprite, repeated unique actor names, invalid destinations, actual store placement/selection, undo/redo, trigger copies, spawn shortcut contents and full-scene limits. World positions remain unchanged.
- Native/compiler regression suite passed with the new manual-collection prefab pool: Spawn Prefab reserves and instantiates its compiled pool actor, touch collection stays off, its compiled On Interact targets Collect Actor on the correct Self index, and explicit collection schedules its compiled reward/removal handler once. Full-thread retry and duplicate-collection rejection are covered.
- All prior #1–#7 native collision, pickup, animation-state and actor-input tests still pass. Compiler custom-script tests and reference tests pass, including actor-reference renaming in Collect Actor.
- Type checks, renderer/Electron production build, and both full GBA ROM builds passed. Existing Vite CJS API and bundle-size advisories remain.
- Windows UI inspection confirmed the top-of-panel Place/Spawn actions and the visible Collect Actor event in the disposable project. The user confirmed successful prefab drag-and-drop. The desktop automation drag did not reliably reproduce native HTML drag-and-drop, so it is not counted as an independently automated UI drag pass. The final implementation retains the working native drag path.

No GBA emulator/device gameplay was exercised. Host tests execute collision/collection/spawn APIs and inspect compiled instructions while stubbing script scheduling and rendering. The full interpreter, including collection retry, is compiled by the ROM builds.
