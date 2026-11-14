# Changelog

## 0.7.0-alpha — 2026-11-14

### Edit scenes on the world map

- The world map is a real editor, like GB Studio's world view: the selected scene is the full scene editor in place (paint, place, select and drag with every tool), with the other scenes around it. Click another scene to edit it, drag a scene's name bar to move it, wheel to zoom, middle-drag to pan.
- The world map keeps its zoom and scroll when you go to the scene view and back, and moving one scene no longer shifts scenes that haven't been placed.

### Fixes

- Scenes in a folder find their animated tiles' images.
- Long Draw Text wraps to the room left on screen (up to 18 lines); Draw Text slots share one bigger pool of tiles.
- Set Actor Transparency works while a light or dialogue dim is on; Control Actor On Update works on the player.
- Dialogue portraits keep their colors under screen tint, lights and dialogue dim.
- On Init's instant events run before a scene fades in, so tint, day / night and lights don't pop in afterwards; a light takes over from the fade without a bright frame.
- Event blocks don't fold by surprise; events drop anywhere on a block or between blocks.
- Speech bubbles: the preview matches the game and long text uses the normal box width.
- Engine settings' state pickers list every player sprite's states; Change Scene's Pick opens the target scene.

### Scenes and actors

- 32 actors per scene (was 16).
- Ceiling slope collision tiles (45 degrees and gentle, both ways).
- Show Emote event (exclaim, question, heart, dots, music, anger, sweat, sleep).
- Top Down hookshot; the platformer grapple can reel actors in or fly the player to them.
- Replace Tile can copy from another background, with a picture to click the tile on.

### Dialogue and menus

- Menu position (bottom, top, middle, left, right, top right, center, custom) and its own open / close animation; the pause template opens top right.
- Menu cursor styles or your own assets/ui/cursor.png (Settings > Dialogue).
- Speech Bubble in Add Event > Dialogue; Display Text can use A, B, L, R, START, SELECT or any to move on.

### Editor

- Searchable pickers for sprites (with pictures), actors and animation states.
- Select several events (Ctrl / Shift + click) to copy, cut, disable, snippet or delete them.
- Duplicate, copy and paste whole scenes; sort the scene list by name, newest, last edited or color.
- Listen buttons next to sound pickers; color-coded build log; Set Actor Frame shows the frames to click.
- Hovering If Actor Distance or Line Of Sight shows the tiles it covers.


## 0.6.1-alpha — 2026-10-31

### Pickup collection and prefab placement

- **On Collect** now explains collection directly and offers **Make this actor a Pickup**. With **Collect on touch** enabled, walk the player into the actor during the game. Put the reward and **Remove Actor → Self** in On Collect.
- Added **Collect Actor** for explicit/scripted collection. For button-based collection, turn off Collect on touch and add **Collect Actor → Self** to the pickup's On Interact script. Collection still runs once per instance and retries if script threads are full.
- Prefabs can be dragged from the sidebar onto the scene canvas or onto a scene in the world map. There is also a visible sidebar **Place** button and a **Place on map** action at the top of prefab properties.
- Actor prefab properties now offer **Add Spawn Prefab to scene start**. It adds an editable Spawn Prefab event to the active scene's On Init, initially reserving one instance at the player-start tile. Spawn Prefab remains available under **Add Event → Actors** for other scripts. Trigger prefabs support map placement; runtime spawning is for actor prefabs.
- Placed prefab copies have independent scripts and unique actor names. Placement supports undo/redo, accounts for zoom and scrolling, keeps footprints inside scene edges, and leaves world scene positions unchanged. Scenes with 16 placed actors reject further placement/spawn shortcuts; scripted pool limits are also checked when building.

### Reusable actor scripts and animation states

- **Set Actor State** now lists named states from across the project, including in custom scripts and prefab scripts without a scene actor selected.
- Named states resolve against the actor's **current sprite sheet** during play. A custom script can set Player's alternate-character states after Set Player Sprite, even if those states do not exist on the starting sheet. Shared names work when their state indices differ between sheets.
- If a known project state is absent from the current sheet, the event leaves the actor's animation unchanged. Default still returns to state 0 and releases the player's script-controlled state. Existing numeric state events remain supported.
- Added **+ Actor input** beside actor fields in custom scripts and in their Inputs panel. It creates `@actorA`, `@actorB`, and so on; each **Call Script** chooses Player or an actor from its own scene. Existing custom-script inputs remain supported.
- Actor inputs work through nested custom-script calls, including calls from actor-owned scripts using Self.

**Usage:** in a custom script, choose **+ Actor input** in Set Actor State's Actor field, then select a named state. At each Call Script, bind that input to the desired actor or Player. For alternate player characters, change the sprite before calling the state script. Rebuild ROMs to include current-sheet state lookup.

### Independent actor behavior and safe pickups

- Added **Solid to player**, **Movement collisions**, and **Interaction** settings for actors and actor prefabs. Actors can remain grounded by tile collisions while being non-solid to the player, interactable, and independently configured for damage.
- Added **Set Actor Solid**, **Set Actor Interaction**, and **Set Actor Collision Group** events. The existing Set Actor Collisions event keeps its movement-collision master-switch behavior.
- In platformer scenes, **Auto** solidity now follows the Platform checkbox: unchecked actors are pass-through; checked actors are one-way platforms. Choose **Solid** explicitly for an actor that should block without being a platform. Other scene types keep solid actors by default.
- Added a dedicated **Pickup (safe)** collision group and **On Collect** tab. Combat groups 1–4 remain unchanged. Pickups never block the player, cause automatic contact damage, receive projectile hits, or bounce projectiles.
- To turn a defeated enemy into a pickup, use **Set Actor Collision Group → Self → Pickup**, optionally change its sprite/state, and put the reward plus **Remove Actor → Self** in **On Collect**. Pickup conversion preserves tile collision, interaction and scripts.
- On Collect runs once per actor instance on actual hitbox overlap, independently of combat invincibility and damage-response switches. An empty handler does nothing. If no script thread is available, collection remains pending for a later check. Without Remove Actor, the collected actor remains visible but does not award again.
- Pause restores preserve collision settings and collection state. Respawned pooled actors return to their authored enemy settings with a fresh collection state.
- New scripts and events participate in reference searches, renaming, dialogue tools and world-map connections.

**Existing platformer projects:** actors using Auto with Platform unchecked now let the player pass through. Set **Solid to player → Solid** on actors intended to remain full blockers. Rebuild your ROMs after these changes.

### Damage response controls

- Each actor and actor prefab's **On Hit 1–4** tab now has an enable switch. Turning it off preserves the script and lets that projectile group pass through without applying damage or being consumed. Solid-actor bouncing remains independent.
- Added **Set Actor Hit Response** under Actors. Scripts can enable or disable player contact, any incoming group, or all hit responses during play. Movement collisions and visibility stay independent.
- The event also supports Player: Contact controls actor contact; groups control incoming projectiles, damage tiles and shoot-em-up wall hits.
- Re-enabling contact works while actors remain touching. Real-pause scene restores preserve the response settings; respawned actors return to their authored defaults.
- Empty player projectile-hit handlers now leave the projectile untouched, matching empty actor handlers.
- Verified the player-hit separation, actor script tabs and projectile groups together across all 16 combinations of actor target group and incoming projectile group.

### Actor script tabs and collision groups

- Actors and actor prefabs now have **On Interact**, **On Init**, **On Update**, **On Player Hit**, and **On Hit 1–4** tabs.
- **On Player Hit** can use a custom actor-contact script or the scene/player handler, with an enable switch. An empty custom script disables that actor's player-damage response. The actor needs a collision group. In an actor script, Self means the actor; target Player for player effects.
- **On Hit 1–4** respond to the incoming projectile's group. The projectile's Hits selection still determines which actors it can target. For example, a projectile in group 4 targeting actors in group 2 runs **On Hit 4** on an actor assigned to group 2.
- Added group 4 to actors, projectile settings, scene/player hit tabs, damage-tile settings and shoot-em-up wall-hit settings.
- Empty custom projectile handlers cause no damage response and do not consume the projectile. Actor bouncing remains a separate solid-actor behavior.
- Existing actor **On Hit** scripts remain available under **Legacy On Hit**. Each group uses the legacy handler until you select a custom script for that group. First Person 3D shooting uses group 1.
- New scripts participate in reference searches, renaming, dialogue export/import and world-map scene connections. Actor tabs wrap to fit the inspector.

### Player and actor hit detection

- Touching an actor now runs the matching scene/player **On Player Hit** script. It no longer runs the actor's **On Hit** script.
- Actor **On Hit** remains the response to projectile hits and First Person 3D shooting.
- An empty **On Player Hit** handler causes no knockback or invincibility. Add events to that group's handler to enable a damage response.
- Actors with movement collisions disabled can still receive projectile hits and be interacted with in platformer scenes.
- Non-solid actors must overlap the player's collision box to cause contact damage. Solid actors can still hurt the player at their blocking edge.
- Hidden and pinned actors remain excluded. Projectile bounces still require a solid actor.
- Updated editor hints explain which hit script runs.

### Existing projects

If you used an actor's **On Hit** script for damage to the player on contact, move that player-damage logic into the scene/player **On Player Hit** tab for the actor's collision group. Keep enemy-damage logic in the actor's **On Hit** tab. Rebuild the ROM to use these fixes.

Existing project fields remain supported. New optional actor fields store the separate contact and group scripts; rebuild ROMs to use them.
