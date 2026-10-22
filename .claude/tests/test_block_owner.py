#!/usr/bin/env python3
"""Offline tests for who a block comment tells to act.

Lanes copied "Eric", the upstream plugin author, from the skill text into 🙋 and 🔑 block
comments on #104, #117 and #175. The human now comes from the config's
`notifications.human_identity`; a plugin upgrade that brings the old name back fails here.
Run: python3 -m unittest discover -s .claude/tests
"""
import json
import re
import unittest

from test_github_read import ROOT

CONFIGS = sorted((ROOT / "super-board/configs").glob("*.json"))
LANE_SKILLS = ["super-board", "super-build", "super-qa", "super-review", "super-collect"]
UPSTREAM_AUTHOR = re.compile(r"\bEric\b")


class BlockOwnerTest(unittest.TestCase):
    def test_every_config_names_a_human_apart_from_the_bot(self):
        self.assertTrue(CONFIGS)
        for path in CONFIGS:
            ids = json.loads(path.read_text()).get("notifications", {})
            with self.subTest(config=path.name):
                self.assertTrue(ids.get("human_identity"))
                self.assertNotEqual(ids.get("human_identity"), ids.get("bot_identity"))

    def test_lane_skills_never_name_the_upstream_author(self):
        files = [p for skill in LANE_SKILLS for p in (ROOT / "skills" / skill).rglob("*.md")]
        files.append(ROOT / "workflows/super-board-wave.js")
        hits = [f"{p.relative_to(ROOT)}:{n}" for p in files
                for n, line in enumerate(p.read_text().splitlines(), 1) if UPSTREAM_AUTHOR.search(line)]
        self.assertEqual(hits, [])


if __name__ == "__main__":
    unittest.main()
