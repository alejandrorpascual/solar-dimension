#!/usr/bin/env python3
"""Offline tests for a board read that comes back with no cards.

On 2026-10-22 `super-board-card.sh items` returned `{"items": [], "totalCount": 0}` for a
117-card board, then 117/117 on the next call. Zero is retried, then believed only when
GitHub search finds no open issue on the board, so a new board still reads as empty.
The halt file lives in a temp directory, so no test can halt the live board.
Run: python3 -m unittest discover -s .claude/tests
"""
import json
import unittest

from test_github_read import HALTED, MISREAD, ROOT, StubGitHub

CARD = ROOT / "bin/super-board-card.sh"
PLANNER = ROOT / "bin/super-board-wave-plan.sh"
ITEM_LIST = ["project", "item-list", "1", "--owner", "x", "--format", "json", "--limit", "500"]
BOARD_QUERY = "items(first:100"
SEARCH = "search(query"


def item_list(count):
    """What `gh project item-list --format json` prints."""
    return {"items": [{"id": f"PVTI_{n}", "status": "Ready", "title": f"Card {n}",
                       "content": {"type": "Issue", "number": n, "title": f"Card {n}",
                                   "url": f"https://github.com/x/y/issues/{n}"}} for n in range(1, count + 1)],
            "totalCount": count}


def board_pages(count):
    """What super-board-card.sh's paginated board query prints."""
    nodes = [{"id": f"PVTI_{n}", "fieldValueByName": {"name": "Ready"},
              "content": {"__typename": "Issue", "number": n, "title": f"Card {n}",
                          "url": f"https://github.com/x/y/issues/{n}", "repository": {"nameWithOwner": "x/y"},
                          "labels": {"nodes": []}, "assignees": {"nodes": []}}} for n in range(1, count + 1)]
    return [{"data": {"repositoryOwner": {"projectV2": {"items": {
        "totalCount": count, "pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": nodes}}}}}]


def search(count):
    return {"data": {"search": {"issueCount": count}}}


class EmptyBoardReadTests(StubGitHub, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.env["SB_CARD_CACHE_DIR"] = str(self.work / "cache")
        config = {"verify_commands": ["npm test"], "project": {"owner": "x", "number": 1},
                  "repo": {"path": ".", "remote": "x/y"}}
        deps = {str(n): {"runnable": True, "blockers": [], "parseable": True} for n in range(1, 4)}
        (self.work / "config.json").write_text(json.dumps(config))
        (self.work / "deps.json").write_text(json.dumps(deps))

    def plan(self):
        return self.run_command("bash", str(PLANNER), "--config", str(self.work / "config.json"),
                                "--deps", str(self.work / "deps.json"))

    def searches(self):
        return [call for call in self.calls() if SEARCH in call]

    def test_empty_then_full_item_list_returns_the_full_board(self):
        self.reply("item-list", item_list(0), then=item_list(3))
        result = self.run_helper("--kind", "items", "--", *ITEM_LIST, strict=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["totalCount"], 3)
        self.assertEqual(self.searches(), [], "a full board needs no second opinion")
        self.assertFalse(self.halt_file.exists())

    def test_item_list_that_stays_empty_while_search_finds_cards_halts_a_strict_read(self):
        self.reply("item-list", item_list(0))
        self.reply(SEARCH, search(75))
        result = self.run_helper("--kind", "items", "--", *ITEM_LIST, strict=True)
        self.assertEqual(result.returncode, HALTED, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertIn("75 open issues", result.stderr)
        self.assertEqual(json.loads(self.halt_file.read_text())["operation"]["kind"], "items")
        self.assertEqual(len([c for c in self.calls() if "item-list" in c]), 3)

    def test_item_list_that_stays_empty_fails_a_lane_read_without_halting(self):
        self.reply("item-list", item_list(0))
        self.reply(SEARCH, search(75))
        result = self.run_helper("--kind", "items", "--", *ITEM_LIST)
        self.assertEqual(result.returncode, MISREAD, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(self.halt_file.exists())

    def test_new_board_reads_as_empty_when_search_finds_nothing(self):
        self.reply("item-list", item_list(0))
        self.reply(SEARCH, search(0))
        result = self.run_helper("--kind", "items", "--", *ITEM_LIST, strict=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"items": [], "totalCount": 0})
        self.assertEqual(len(self.searches()), 1)
        self.assertIn("project:x/1 is:open", self.searches()[0])
        self.assertFalse(self.halt_file.exists())

    def test_empty_read_followed_by_a_short_board_is_not_believed(self):
        short = dict(item_list(4), totalCount=5)
        self.reply("item-list", item_list(0), then=short)
        self.reply(SEARCH, search(0))
        result = self.run_helper("--kind", "items", "--", *ITEM_LIST, strict=True)
        self.assertEqual(result.returncode, HALTED, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertIn("board item list incomplete", result.stderr)

    def test_empty_read_that_names_no_owner_is_not_believed(self):
        self.reply("item-list", item_list(0))
        result = self.run_helper("--kind", "items", "--", "project", "item-list", "1", "--format", "json")
        self.assertEqual(result.returncode, MISREAD, result.stderr)
        self.assertEqual(self.searches(), [])

    def test_planner_plans_the_full_board_after_one_empty_read(self):
        self.reply(BOARD_QUERY, board_pages(0), then=board_pages(3))
        result = self.plan()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([card["number"] for card in json.loads(result.stdout)["cards"]], [1, 2, 3])
        self.assertFalse(self.halt_file.exists())

    def test_planner_refuses_a_board_that_stays_empty_while_search_finds_cards(self):
        self.reply(BOARD_QUERY, board_pages(0))
        self.reply(SEARCH, search(75))
        result = self.plan()
        self.assertEqual(result.returncode, HALTED, result.stderr)
        self.assertEqual(result.stdout, "", "no empty plan")
        self.assertIn("75 open issues", result.stderr)
        self.assertEqual(json.loads(self.halt_file.read_text())["operation"]["kind"], "board")

    def test_resume_clears_the_empty_board_halt_once_the_board_reads_full(self):
        self.reply(BOARD_QUERY, board_pages(0))
        self.reply(SEARCH, search(75))
        self.assertEqual(self.plan().returncode, HALTED)
        self.reply(BOARD_QUERY, board_pages(3))
        result = self.run_helper("--resume")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.halt_file.exists())

    def test_planner_plans_nothing_for_a_new_empty_board(self):
        self.reply(BOARD_QUERY, board_pages(0))
        self.reply(SEARCH, search(0))
        result = self.plan()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["cards"], [])

    def test_card_items_keeps_refusing_a_short_board_read(self):
        short = board_pages(3)
        short[0]["data"]["repositoryOwner"]["projectV2"]["items"]["totalCount"] = 4
        self.reply(BOARD_QUERY, short)
        result = self.run_command("bash", str(CARD), "--owner", "x", "--number", "1", "items")
        self.assertEqual(result.returncode, 69, result.stderr)
        self.assertIn("3 of 4 items", result.stderr)


if __name__ == "__main__":
    unittest.main()
