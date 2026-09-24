#ifndef ADVANCE_TIMER_H
#define ADVANCE_TIMER_H

/*
 * Background timers - SCRIPT_START_TIMER's engine side (see script.h).
 * Unlike SCRIPT_WAIT, a timer counts down independently of whatever
 * script is currently running (or of no script running at all) and
 * fires its own separate script - the current scene's TimerDef (see
 * scene.h) - when it reaches 0, without blocking or being blocked by
 * anything else.
 *
 * If another script is still active (or dialogue is still open) at
 * the exact moment a timer's countdown reaches 0, that firing is
 * simply skipped - not queued, not delayed to the next free moment.
 * Timers are a "nudge something along in the background" primitive,
 * not a scheduler. A timer is one-shot; start it again (another
 * start_timer event, including from within the script it just fired)
 * to repeat it.
 *
 * Implemented in main.c, which owns both the per-frame loop that ticks
 * these down and the currently loaded scene's TimerDef array. A new
 * scene loading resets every timer (see scene.h's "timers" and
 * compiler/build_project.py) - a timer armed in one scene never fires
 * in another.
 */

/* Arms (or re-arms) timer `index` (0-based, within the current scene's
 * "timers" list) with its configured frame count. Out-of-range indices
 * are silently ignored. */
void timer_start(int index);

#endif
