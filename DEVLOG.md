# Shimmer Engine Devlog #5: Your feedback, fixed

This one is straight from your comments. Someone sent a great list of things that felt off or were missing compared to GB Studio, and every one of them is in.

## Scripts

- **Button scripts don't freeze the player any more.** Scripts attached to a button used to stop everything while they ran, so an attack animation would leave you hanging in mid-air. Now they run alongside the game, like in GB Studio: you keep moving and jumping while the script plays. If you want the old behaviour (a pause menu, say), tick **Freeze player while it runs** on Attach Script To Button. If you already have button scripts, check them: by default they now run in the background.
- **Move Actor To got all the GB Studio options:**
  - Move to a position, to a position stored in **variables**, or to **another actor or the player**.
  - **Relative** moves ("2 tiles left of where it is").
  - **Tiles or pixels.**
  - **Collisions**: stop at solid tiles instead of walking through walls.
  - **Horizontal first, vertical first, or diagonal.**
- **Set Actor Position** gets the same targets, plus relative and pixel options.
- **Every actor event works on the player.** Pick **Player** in any actor event, and **Self** works in all of an actor's own scripts (On Init, On Update, On Hit and On Interact).

## A real pause

**Store Current Scene** has a new **Remember everything** option. Go to your pause menu scene, come back, and the game carries on exactly where it left off: every actor's position, direction, animation state and visibility, all running scripts and timers. The scene's On Init doesn't run again, so nothing resets.

## Dialogue

- **Put the box anywhere.** Display Text has a new **Custom** position with X, Y and width in tiles. Make a small box in a corner, a narrow panel down one side, or a single line of HUD text, wherever you want it. The preview shows the box at its real size.
- **Pause the world during dialogue** is a new engine setting. Turn it on and actors and background scripts stop while a box is open. Leave it off and the world keeps moving, so you're never truly safe. You can switch it mid-game with Set Engine Setting.

## Editor

- **Picking an actor's position shows the whole actor.** Positions are the actor's top-left tile, but a 16x16 actor covers four tiles, so reading the cursor at its feet put it a tile too low. When you press Pick for an actor event, the canvas now shows the actor's full box, so you can see exactly where it'll stand.
- **Play opens one emulator.** Pressing Play again closes the emulator it opened last time, instead of piling up windows. This also fixes builds failing because the old emulator still had the ROM open.
- **Choose your emulator** under **File > Emulator for Play**, or keep using whatever program your .gba files open with.

As always, it's an early alpha, so tell me what breaks: https://www.reddit.com/r/ShimmerEngine/

---

# Shimmer Engine Devlog #4: An art editor, Mac and Linux, and a fresh look

This is the biggest update yet. Shimmer now has its own pixel art editor, runs natively on Mac and Linux, and the whole editor got a new, easier-to-read look. A lot of this came straight from your comments, so keep them coming.

## Art Editor

There's a new **Art Editor** in the section dropdown, next to Game World, Sprites and Music. It's a full pixel art editor for your project's own images, inspired by Pixelorama.

- **Your art, ready to edit.** The left side lists your backgrounds, sprites, fonts and dialogue frames with thumbnails. Click one to open it, or make a new one with **+ New**. Saving writes straight back into your project, so your scenes and builds use it right away.
- **Tools:** pencil, eraser, fill, line, rectangle, ellipse, gradient, shading, stamp, colour picker, select, move and hand. Left click draws with your main colour, right click with your second one.
- **Pencil extras:** brush sizes, dithering, "pixel perfect" lines, and mirror drawing left/right and up/down.
- **Shading tool:** click to lighten or darken a pixel, using only colours already in the image, so you never add colours by accident.
- **Gradients** use only the colours you pick, with retro dithering in between.
- **Custom brushes:** select part of an image and turn it into a stamp.
- **Layers:** add, duplicate, reorder, merge, hide, lock, set opacity and rename. Your layers are kept for next time, and the game still gets one finished image.
- **Animation:** cut a sprite sheet into frames, flip through them on a timeline, play the animation at any speed, and turn on onion skin to see the frames before and after the one you're drawing.
- **Tile mode** shows your image repeated all around it, and drawing wraps across the edges, so seamless tiles are easy.
- **GBA-aware palette bar.** The bottom shows every colour in the image and warns you when a sprite goes over 15 colours, or an 8x8 background tile does. **Reduce colours** fixes it for you, and **Snap to GBA colours** rounds colours to what the GBA can actually show.
- **Image menu:** resize the image or the canvas, flip, rotate, add an outline, swap colours, import an image as a layer, and export a PNG or an animated GIF.
- **Keyboard shortcuts** for every tool, and you can change them all.

## Mac and Linux

Shimmer now comes for **Windows, Mac and Linux**, built fresh every update.

- **Linux:** a `.deb` (double-click to install) and an AppImage. These run natively, so no more Wine (which made it very slow). They work on Ubuntu 22.04-based distros like Zorin 17 and Mint 21, and newer.
- **Mac:** a `.dmg` for Apple Silicon Macs (M1 and newer). The first time you open it, right-click the app and choose **Open**.
- Every version includes everything a ROM build needs, so you just install and press Build ROM.

## A new look

- **High-contrast theme.** Clean greys with light text, slightly bolder and bigger text everywhere, and much bigger dropdown arrows.
- **Themes** under **View > Theme**: Dark, Light, Midnight Blue, and Classic Purple if you miss the old look.
- **Tooltips** now appear just above your mouse, in the editor's style.
- The tile position above a scene now reads clearly as **X= Y=**.
- The Game World / Sprites / Music switcher moved to the top left, above the sidebar.

## Dialogue

- **Box position:** Display Text can show its box at the bottom, middle or top of the screen.
- **Rows:** pick 1 to 4 lines of text per box.
- **No frame:** turn the box off for just text on screen. With 1 row, that's a single line you can use for UI like "HP 10/10".
- **Coloured text:** type `!C:#ff4040!` to colour the text from there on, and `!C!` to go back. Shadows and outlines in your font stay as they are.
- **Insert bar:** buttons under the text box add the codes for you: change font, colour, text speed, or show a variable. Changing fonts mid-text with `!F` already worked; now it's easy to find.
- **15 built-in fonts**, clean and coloured, ready to use in any project.

## New stuff

- **Disable events**, just like GB Studio. Right-click any event and choose **Disable event**. It stays in your script, greyed out, but is skipped when you build. Events with an Else branch can also **Disable else**.
- **Right-click to delete** actors, triggers and notes right on the scene.
- **File menu:** New Project, Open Project, Save, Save As (copies your whole project somewhere new) and Reload Assets.

## Bug fixes

- **Set Actor State now works on the player.** Pick Player as the actor. In modes like platformer, the state you set now stays until you set Default again, instead of being replaced straight away. The state list also shows the right sprite when a scene uses its own player sprite.
- **More than 16 actors in a scene** now gives a clear error when you build, instead of the extra actors quietly not showing up.

As always, it's an early alpha, so tell me what breaks: https://www.reddit.com/r/ShimmerEngine/

---

# Shimmer Engine Devlog #3: Bug fixes and your wishlist

Quick one this time. I went through the list of bugs and requests you sent in and knocked out all of it.

## Bug fixes

- **Falling through the floor after a scene change.** If a title screen hid the player, the player stayed "ghosted" in the next scene and fell right through the level. Fixed, and a new scene always shows the player again.
- **Text not showing after Camera Move To.** Moving the camera near the edge of a scene got it stuck, so the next Display Text never came up. Fixed.
- **Platformer walk and jump animations were swapped.** Fixed.
- **Mashing A skipped dialogue.** Boxes now ignore buttons for a few frames after they open, turn a page or close.
- **Wall jumping off NPCs.** Wall jumps and wall slides only work off solid walls now.

## New stuff

- **Player settings.** Click the player in a scene to give it its own On Init, On Update and On Hit scripts, animation speed and collisions, just like an actor.
- **Double jump** checkbox in the platformer settings.
- **Wall kick push.** A setting that keeps a wall jump going up for a few frames, so it doesn't just fall away.
- **Wall Slide and Wall Kick animations** for platformer sprites.
- **Sound effects** for jump, land, wall slide and wall kick, picked right in the engine settings.
- **Projectiles** can be drawn in front of the player, and can hit any mix of collision groups.
- **Camera Move To** has a speed option, and its Pick button shows the area the camera will show.
- **Line Of Sight** event. Pokemon trainer style: when the player walks in front of an actor, a script runs. You pick the range, and walls can block the view.
- **Live dialogue preview.** Display Text shows the box exactly as it'll look in the game while you type, pages and all.
- **Folders, GB Studio style.** Put a "/" in a scene's name, like "Forest/Cave 1", and it goes in a Forest folder in the list, with its file moved into a matching folder in your project. Drag scenes onto folders to move them, and double-click a folder to rename it. Scripts, palettes, prefabs and sprites can be put in folders the same way.
- **Copy Log button** in the build window, so you can paste build errors straight into a message.
- New projects come with every asset folder already made, so you know where things go.

## Removed

- The Game Boy only events (If Color Supported, If Device Is GBA, If Device Is Super Game Boy). They did nothing on a GBA.

As always, it's an early alpha, so tell me what breaks: https://www.reddit.com/r/ShimmerEngine/

---

# Shimmer Engine Devlog #2: Game modes, fonts and a lot more

Hey everyone. It's been a busy stretch since the first alpha went up, and this update is a big one. The short version: scenes can now be platformers, shooters, point and click and more, and a lot of the things that were grayed out or missing from the editor are in.

## Game modes

This was the big one on the to-do list. Every scene now has a type, just like GB Studio, and the type changes how the player controls:

- **Top Down** - what we had before, plus a grid option (move a full 8 or 16 pixel tile per press, like classic RPGs), running, and diagonals if you want them.
- **Platformer** - gravity, acceleration, running, jumps that go higher the longer you hold the button, coyote time, jump buffering, double jumps, wall jumps, wall sliding, ladders, one-way platforms you can drop through, dashing, floating and knockback when you get hit.
- **Adventure** - free 8-way movement with a bit of momentum, running, dashing and pushing things around.
- **Shoot Em' Up** - the screen scrolls on its own and the player stays on screen.
- **Point and Click** - the player is a cursor. Hover over things and press A.
- **Logo** - no player at all, for title cards and splash screens.

Every one of these has its settings in **Settings > Engine**: walk speed, gravity, jump height, how many air jumps, which button dashes, and so on. Speeds are in pixels per frame so you can actually reason about them. On top of that, any scene can override settings just for itself (low gravity moon level, anyone?), and there's a **Set Engine Setting** event so you can change them mid-game, like unlocking double jump after picking up a power-up.

A few things in there that GB Studio doesn't do: crouching, camera look-ahead in platformers, a blink and a moment of invincibility after getting hit, damage tiles that actually hurt, and L and R as usable buttons. Those are marked "GBA" in the settings.

If your sprite has animation states called things like `jump`, `fall`, `climb`, `run` or `dash`, the engine picks them up automatically. No setup.

## Projectiles

There's a new **Launch Projectile** event. Fire a sprite from the player or any actor, in the direction they're facing or at any angle. It can hit actors in a collision group (which runs their On Hit script) or the player (which runs the scene's On Player Hit). Hook it up to a button and you've got a shooter.

## Actors and scenes got a lot more options

I went through GB Studio's scene and actor panels and brought over what makes sense on the GBA:

- Actors can be **pinned** to the screen for HUD-style stuff.
- Actors have movement speed, animation speed and a **collision group**.
- Actors now have **On Init**, **On Update** (runs every frame in the background) and **On Hit** scripts, not just On Interact.
- In platformer scenes an actor can be a **platform**: you can stand on it, and if it moves, you ride it. Moving lifts, basically.
- Triggers get an **On Leave** script.
- Scenes can use a different player sprite each.
- Direction pickers are arrow buttons now, like GB Studio.

## Parallax, the GBA way

First I added GB Studio's parallax (splitting the screen into strips that scroll at different speeds). Then someone pointed out that GBA games like Lady Sia do it with real layers, and they're right. The Game Boy only had one background layer, so strips were all it could do. The GBA has four.

So now scenes can have up to two full **background layers** behind (or in front of) the map, each with its own scroll speed, plus an optional drift so clouds can move on their own. Both styles are in, use whichever fits.

## Fonts and dialogue frames

GB Studio's font system is in. Fonts are the same PNG format, so GB Studio fonts drop straight in, and they're variable width. You can use real colors instead of four shades, swap fonts mid-sentence, change text speed, and swap the dialogue box frame. If you want to make your own, **Settings > Dialogue** has a button that copies the built-in font and frame into your project so you can open them in any image editor.

## Smaller stuff

- **Open Folder** button in the top bar.
- Long dialogue now wraps and continues onto the next page on its own.
- Fixed: showing the first variable in your list in text would cut the text off.
- Fixed: `Wait` events waited one frame longer than you asked.

## What's next

Platformer slopes are the big one I skipped this round. After that I want to look at saving/loading more stuff, better sprite tools and whatever you all run into.

Speaking of which: **it's still an early alpha**. Things will break. If something doesn't work the way you'd expect, or GB Studio does something you're missing, tell me on the subreddit: https://www.reddit.com/r/ShimmerEngine/

There's also a new example project, examples/game_modes on the GitHub repo, with a platformer level and a little shooting level if you want to poke at the new stuff.

Thanks for trying it out.

HoloCatt
