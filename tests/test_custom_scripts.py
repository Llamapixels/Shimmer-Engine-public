"""Compiler regressions for reusable actor inputs and current-sheet named states."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "compiler"))
from build_project import BuildError, PLAYER_ACTOR_INDEX, compile_script


class CustomScripts(unittest.TestCase):
    def context(self):
        return {
            "all_state_names": {"attack", "guard"},
            "scene_npc_count": 2, "npc_name_to_index": {"enemy": 1},
            "npc_sprite_of": {0: "hero", 1: "other", PLAYER_ACTOR_INDEX: "hero"},
            "sprite_state_names": {"hero": {"": 0, "attack": 1}, "other": {"": 0, "guard": 1, "attack": 2}},
            "self_actor_index": 1,
            "custom_scripts": {"reuse": [{"type": "actor_set_state", "actor": "@actorA", "state": "attack"}]},
            "custom_script_params": {"reuse": [{"name": "actorA", "kind": "actor"}]},
        }

    def test_actor_bindings_from_each_caller(self):
        for target, expected in (("player", PLAYER_ACTOR_INDEX), ("enemy", 1), (0, 0), ("self", 1)):
            with self.subTest(target=target):
                script = compile_script([{"type": "call_script", "script": "reuse",
                    "args": {"actorA": {"actor": target}}}], self.context(), "test")
                self.assertEqual(script[0]["op"], "SCRIPT_ACTOR_SET_STATE_NAME")
                self.assertEqual(script[0]["a"], expected)
                self.assertEqual(script[0]["str"], '"attack"')

    def test_state_not_on_starting_sheet_is_valid_by_name(self):
        script = compile_script([{"type": "actor_set_state", "actor": "player", "state": "guard"}], self.context(), "test")
        self.assertEqual(script[0]["op"], "SCRIPT_ACTOR_SET_STATE_NAME")

    def test_bad_inputs_are_rejected(self):
        for args in (None, {"actorA": {"var": "hp"}}, {"actorA": {"actor": "absent"}}):
            with self.subTest(args=args), self.assertRaises(BuildError):
                compile_script([{"type": "call_script", "script": "reuse", "args": args}], self.context(), "test")
        for state in ("typo", "attack\0", True, -1, 1000):
            with self.subTest(state=state), self.assertRaises(BuildError):
                compile_script([{"type": "actor_set_state", "actor": "player", "state": state}], self.context(), "test")

    def test_default_and_numeric_compatibility(self):
        for state, expected in (("", 0), ("Default", 0), ("default", 0), (1, 1)):
            script = compile_script([{"type": "actor_set_state", "actor": "player", "state": state}], self.context(), "test")
            self.assertEqual((script[0]["op"], script[0]["b"]), ("SCRIPT_ACTOR_SET_STATE", expected))


if __name__ == "__main__":
    unittest.main()
