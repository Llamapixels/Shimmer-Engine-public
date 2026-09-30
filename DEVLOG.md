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
- **Folders.** Put a "/" in a name, like "Forest/Cave 1", and it goes in a folder in the list.
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
