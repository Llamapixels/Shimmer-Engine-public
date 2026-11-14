/**
 * Add Event > Templates: ready-made menus built from ordinary events
 * (Menu, Save Slot Menu, Load Data...). Once added they're plain events,
 * so every label and step can be changed.
 */
import type { EventScript, ScriptEventJSON } from "../../shared/eventTypes";

export interface EventTemplate {
  id: string;
  name: string;
  description: string;
  /** Variables the events use; added to the project if missing. */
  variables: string[];
  build: (firstScene: string) => EventScript;
}

const ev = (e: Record<string, unknown>) => e as unknown as ScriptEventJSON;

/** Text speed and music volume, until Back. */
function optionsMenu(): EventScript {
  return [
    ev({ type: "set_var", var: "menu_back", value: 0 }),
    ev({
      type: "loop_while",
      expression: "menu_back == 0",
      body: [
        ev({
          type: "menu",
          options: [
            {
              label: "Text speed",
              then: [
                ev({
                  type: "menu",
                  options: [
                    { label: "Instant", then: [ev({ type: "text_set_speed", speed: 0 })] },
                    { label: "Fast", then: [ev({ type: "text_set_speed", speed: 1 })] },
                    { label: "Normal", then: [ev({ type: "text_set_speed", speed: 2 })] },
                    { label: "Slow", then: [ev({ type: "text_set_speed", speed: 4 })] },
                  ],
                }),
              ],
            },
            {
              label: "Music volume",
              then: [
                ev({
                  type: "menu",
                  options: [
                    { label: "Loud", then: [ev({ type: "music_fade", fade: "volume", volume: 7, frames: 1 })] },
                    { label: "Medium", then: [ev({ type: "music_fade", fade: "volume", volume: 5, frames: 1 })] },
                    { label: "Quiet", then: [ev({ type: "music_fade", fade: "volume", volume: 2, frames: 1 })] },
                    { label: "Off", then: [ev({ type: "music_fade", fade: "volume", volume: 0, frames: 1 })] },
                  ],
                }),
              ],
            },
            { label: "Back", then: [ev({ type: "set_var", var: "menu_back", value: 1 })] },
          ],
        }),
      ],
    }),
  ];
}

/** Pick a slot and load it (B goes back). */
function continueGame(): EventScript {
  return [
    ev({ type: "save_slot_menu", title: "Continue which game?", slots: 3, purpose: "load", empty_text: "Empty", var: "menu_slot" }),
    ev({ type: "if_var", var: "menu_slot", op: ">=", value: 0, then: [ev({ type: "data_load", slot: { var: "menu_slot" } })], else: [] }),
  ];
}

export const EVENT_TEMPLATES: EventTemplate[] = [
  {
    id: "title",
    name: "Title menu",
    description:
      "New Game / Continue / Options, shown again after Options. Put it in the title scene's On Init. New Game goes to the " +
      "first scene - change it to yours.",
    variables: ["menu_slot", "menu_back"],
    build: (first) => [
      ev({
        type: "loop",
        body: [
          ev({
            type: "menu",
            options: [
              { label: "New Game", then: [ev({ type: "switch_scene", scene: first, x: 0, y: 0 })] },
              { label: "Continue", then: continueGame() },
              { label: "Options", then: optionsMenu() },
            ],
          }),
        ],
      }),
    ],
  },
  {
    id: "pause",
    name: "Pause menu (START)",
    description:
      "Press START to pause the world and open Resume / Save / Options / Title. Put it in a scene's On Init (or a custom " +
      "script every scene calls). Quit to Title goes to the first scene - change it to your title scene.",
    variables: ["menu_slot", "menu_back"],
    build: (first) => [
      ev({
        type: "input_script_set",
        buttons: "start",
        override: true,
        script: [
          ev({ type: "pause_world" }),
          ev({
            type: "menu",
            position: "top_right",
            focus: "dim",
            options: [
              { label: "Resume", then: [] },
              {
                label: "Save",
                then: [
                  ev({ type: "save_slot_menu", title: "Save to which slot?", slots: 3, purpose: "save", empty_text: "Empty", var: "menu_slot" }),
                  ev({
                    type: "if_var",
                    var: "menu_slot",
                    op: ">=",
                    value: 0,
                    then: [ev({ type: "data_save", slot: { var: "menu_slot" } }), ev({ type: "text", text: "Saved!" })],
                    else: [],
                  }),
                ],
              },
              { label: "Options", then: optionsMenu() },
              { label: "Quit to title", then: [ev({ type: "resume_world" }), ev({ type: "switch_scene", scene: first, x: 0, y: 0 })] },
            ],
          }),
          ev({ type: "resume_world" }),
        ],
      }),
    ],
  },
  {
    id: "options",
    name: "Options menu",
    description: "Text speed and music volume, until Back. Drop it anywhere, e.g. in a menu option.",
    variables: ["menu_back"],
    build: () => optionsMenu(),
  },
  {
    id: "continue",
    name: "Continue (load a save)",
    description: "The Save Slot Menu for loading, then Load Data with the slot picked (B does nothing).",
    variables: ["menu_slot"],
    build: () => continueGame(),
  },
];
