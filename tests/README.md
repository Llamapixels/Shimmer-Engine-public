# Hit detection checks

Run the native regressions with a host GCC (not the ARM compiler):

```powershell
python tests/run_native.py --cc C:/msys64/mingw64/bin/gcc.exe
```

The harnesses include the engine C sources and stub hardware and script dispatch. Whole-program optimization removes the unused cartridge entry point. Outputs go into the ignored `tests/build/` folder.

The runner also compiles a disposable project variant and executes checks on its generated C data: group-specific handlers, legacy fallbacks, explicit empty handlers, actor Self resolution, player-contact overrides and group 4 projectile operands.

Combined runtime checks cover every actor target group against every incoming projectile group, disabling and re-enabling responses, compiler-produced defaults and event operands, contact/projectile independence, player masking, real-pause snapshot restoration and prefab respawn defaults. Script scheduling and hardware are stubbed; the production interpreter is compiled by the ROM builds.

The integration variant also contains an enemy whose On Hit 4 converts it to Pickup and whose On Collect awards a variable increment and removes Self. Checks cover safe conversion while overlapping, immunity to old damage/solidity switches, no projectile bounce, one-time collection, retry when threads are full, pause restoration, respawn, and platformer default/explicit solidity. A separate entity-source test verifies that non-solid actors and pickups still collide with terrain and clear state when recycled.

Run the editor reference-discovery and rename regressions:

```powershell
node tests/test_script_refs.cjs
```

Run the reusable actor/state compiler tests:

```powershell
python tests/test_custom_scripts.py
```

Run prefab placement/store regressions (persistence is mocked):

```powershell
node tests/test_prefab_placement.cjs
```

These cover independent copies, unique names, zoom-aware placement, trigger placement, undo/redo, scene-start spawn creation and limits. The native fixture also contains a spawned Pickup prefab with touch collection disabled and Collect Actor in On Interact, testing explicit collection without damaging the player.

The generated integration project now has player/alternate sheets with different state orders and an alternate-only guard state. Custom scripts cover actor inputs, nested inputs, actor-init Self, named and numbered scene actors, and Player after a sprite swap. Native checks verify current-sheet name lookup, Default ownership, missing-state no-ops and continued collision/pickup safety. The host sheet-swap model assigns the compiled current sprite definition; hardware allocation and rendering remain outside the host harness.

Compile the fixture ROM with the project's bundled GBA toolchain:

```powershell
python compiler/build_rom.py tests/fixtures/hit_detection --devkitpro editor/toolchain-bundle/devkitpro
```

For manual testing, the fixture has a solid actor to the right and a non-solid actor to the left. Both use collision group 1. Contact should display the player-hit message, never the actor-hit message. The non-solid actor should allow walking through it and interaction. Variables `player_hits` and `actor_hits` track their separate scripts. Projectile behavior is exercised by the native harness; the fixture has no firing controls.
