#!/usr/bin/env python3
"""Offline tests for super-board-github-read.py: the real helper against a stub `gh`.

A misread by a lane fails that one call (exit 64); only GitHub's own failures and
strict fixed-command scripts halt the run (exit 79). The halt file lives in a
temp directory, so no test can halt the live board.
Run: python3 -m unittest discover -s .claude/tests
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "bin/super-board-github-read.py"
HALTED, MISREAD = 79, 64
VIEW = ["pr", "view", "151", "--repo", "x/y", "--json", "labels,files,additions,deletions,changedFiles,body"]
FILES = "repos/x/y/pulls/151/files?per_page=100"
USAGE = "the `--slurp` option is not supported with `--jq` or `--template`\n\nUsage:  gh api <endpoint> [flags]\n"

# Replies by the first needle found in the joined args; every call is logged. A list of
# replies is served in order, its last one repeating.
STUB = '''#!/usr/bin/env python3
import json, os, sys
args = " ".join(sys.argv[1:])
with open(os.environ["GH_CALLS"], "a") as log:
    log.write(args + "\\n")
calls = open(os.environ["GH_CALLS"]).read().splitlines()
for needle, reply in json.load(open(os.environ["GH_FIXTURE"])):
    if needle in args:
        if isinstance(reply, list):
            reply = reply[min(sum(needle in c for c in calls), len(reply)) - 1]
        sys.stdout.write(reply.get("out", ""))
        sys.stderr.write(reply.get("err", ""))
        sys.exit(reply.get("code", 0))
sys.stderr.write("stub: no reply for " + args)
sys.exit(1)
'''


def png(i):
    return {"filename": f"qa/shot-{i}.png", "additions": 0, "deletions": 0, "status": "added"}


def view(files, changed):
    """What `gh pr view --json files` prints: it stops at 100 files."""
    return {"labels": [{"name": "feature"}], "body": "Closes #67", "additions": 20, "deletions": 4,
            "changedFiles": changed, "files": [{"path": f["filename"], "additions": f["additions"],
                                               "deletions": f["deletions"]} for f in files[:100]]}


class GitHubReadTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.work = Path(directory.name)
        stub = self.work / "gh"
        stub.write_text(STUB)
        stub.chmod(0o755)
        self.halt_file = self.work / "halt.json"
        self.env = dict(os.environ, PATH=str(self.work) + os.pathsep + os.environ["PATH"],
                        GH_FIXTURE=str(self.work / "fixture.json"), GH_CALLS=str(self.work / "calls.log"),
                        SB_GITHUB_RETRY_DELAY="0", SB_GITHUB_HALT_FILE=str(self.halt_file))
        self.env.pop("SB_GITHUB_READ_STRICT", None)
        quota = {"resources": {"graphql": {"remaining": 5000, "reset": 1}, "core": {"remaining": 5000, "reset": 1}}}
        self.replies = [["rate_limit", {"out": json.dumps(quota)}]]

    def reply(self, needle, out=None, err="", code=0, then=None):
        first = {"out": "" if out is None else json.dumps(out), "err": err, "code": code}
        self.replies.insert(0, [needle, first if then is None else [first, {"out": json.dumps(then)}]])

    def big_pr(self, rest_files=104, then_files=None):
        files = [png(i) for i in range(100)] + [dict(png(i), filename=f"src/lib/kit-{i}.ts", additions=5, deletions=1)
                                                for i in range(100, 104)]
        self.reply("pr view 151", view(files, 104))
        self.reply(FILES, [files[:100], files[100:rest_files]],
                   then=None if then_files is None else [files[:100], files[100:then_files]])

    def run_helper(self, *argv, strict=False):
        (self.work / "fixture.json").write_text(json.dumps(self.replies))
        env = dict(self.env, SB_GITHUB_READ_STRICT="1") if strict else self.env
        return subprocess.run(["python3", str(HELPER), *argv], env=env, capture_output=True, text=True)

    def calls(self):
        log = self.work / "calls.log"
        return log.read_text().splitlines() if log.exists() else []

    def test_metadata_pages_files_past_the_100_that_pr_view_returns(self):
        self.big_pr()
        result = self.run_helper("--kind", "metadata", "--", *VIEW, strict=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        meta = json.loads(result.stdout)
        self.assertEqual(len(meta["files"]), 104)
        self.assertEqual(meta["files"][-1], {"path": "src/lib/kit-103.ts", "additions": 5, "deletions": 1})
        self.assertEqual(meta["labels"], [{"name": "feature"}])
        self.assertFalse(self.halt_file.exists())

    def test_metadata_pages_files_for_every_repo_form_gh_accepts(self):
        for repo in ("x/y", "github.com/x/y", "https://github.com/x/y", "git@github.com:x/y.git"):
            with self.subTest(repo=repo):
                self.big_pr()
                args = [*VIEW[:4], repo, *VIEW[5:]]
                result = self.run_helper("--kind", "metadata", "--", *args, strict=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(len(json.loads(result.stdout)["files"]), 104)

    def test_file_list_short_once_is_read_again(self):
        self.big_pr(rest_files=102, then_files=104)
        result = self.run_helper("--kind", "metadata", "--", *VIEW, strict=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(json.loads(result.stdout)["files"]), 104)

    def test_resume_clears_the_saved_pr_151_halt(self):
        self.big_pr()
        self.halt_file.write_text(json.dumps({"reason": "PR file list truncated", "attempts": 3, "at": 1,
                                              "operation": {"args": VIEW, "kind": "metadata", "meta": None}}))
        result = self.run_helper("--resume")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.halt_file.exists())
        self.assertEqual(len(list(self.work.glob("github-halt-*.json"))), 1, "the old reason is archived")

    def test_file_list_that_stays_short_fails_a_lane_read_without_halting(self):
        self.big_pr(rest_files=102)
        result = self.run_helper("--kind", "metadata", "--", *VIEW)
        self.assertEqual(result.returncode, MISREAD, result.stderr)
        self.assertIn("PR file list truncated", result.stderr)
        self.assertFalse(self.halt_file.exists())

    def test_file_list_that_stays_short_halts_the_gate_on_a_resumable_read(self):
        self.big_pr(rest_files=102)
        result = self.run_helper("--kind", "metadata", "--", *VIEW, strict=True)
        self.assertEqual(result.returncode, HALTED, result.stderr)
        self.assertEqual(json.loads(self.halt_file.read_text())["operation"]["kind"], "metadata")

    def test_internal_kind_misread_fails_only_that_call(self):
        self.reply("pr list", [{"number": 151, "title": "t", "body": "", "headRefName": "b", "files": []}])
        result = self.run_helper("--kind", "prs-open", "--", "pr", "list", "--json", "number,title,body,headRefName,files")
        self.assertEqual(result.returncode, MISREAD, result.stderr)
        self.assertIn("the run continues", result.stderr)
        self.assertFalse(self.halt_file.exists())

    def test_strict_script_still_halts_on_a_malformed_payload(self):
        self.reply("pr list", [{"number": 151, "title": "t", "body": "", "headRefName": "b", "files": []}])
        result = self.run_helper("--kind", "prs-open", "--", "pr", "list", "--json", "number,title,body,headRefName,files",
                                 strict=True)
        self.assertEqual(result.returncode, HALTED, result.stderr)
        self.assertTrue(self.halt_file.exists())

    def test_gh_usage_error_fails_at_once_without_halting(self):
        self.reply("comments", err=USAGE, code=1)
        result = self.run_helper("--kind", "comments", "--", "api", "repos/x/y/issues/9/comments",
                                 "--paginate", "--slurp", "--jq", ".")
        self.assertEqual(result.returncode, MISREAD, result.stderr)
        self.assertEqual(len(self.calls()), 1, "a usage error is never retried")
        self.assertIn("--slurp", result.stderr)
        self.assertFalse(self.halt_file.exists())

    def test_outage_still_halts_after_three_tries(self):
        self.reply("comments", err="HTTP 502: Bad Gateway (https://api.github.com/...)\n", code=1)
        result = self.run_helper("--kind", "comments", "--", "api", "repos/x/y/issues/9/comments", "--paginate", "--slurp")
        self.assertEqual(result.returncode, HALTED, result.stderr)
        self.assertEqual(len(self.calls()), 3)
        self.assertTrue(self.halt_file.exists())


if __name__ == "__main__":
    unittest.main()
