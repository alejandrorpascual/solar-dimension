#!/usr/bin/env python3
"""super-collect `phase-a-audit` source: the Phase A findings no issue cites yet.

Reads the audit's findings.json, drops every SEC-* finding (the repo is public) and every
finding whose ID appears in the body of an issue, open or closed, so the collector's
50-per-run cap is spent on findings without a ticket. A finding cited only by a PR still
comes through: a PR can fix part of one. Read-only, and it never halts the board: when the
findings or the complete issue history cannot be read it exits 2, so the source shows as
unavailable, never as empty.

    python3 .claude/super-board/sources/phase-a-audit.py <findings.json> <owner/name>
"""
import json
import re
import subprocess
import sys
from pathlib import Path

FINDING_ID = re.compile(r"\b[A-Z]+-\d+\b")
REPO = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
ISSUES = ("query($owner:String!,$repo:String!,$endCursor:String){repository(owner:$owner,name:$repo)"
          "{issues(first:100,after:$endCursor,states:[OPEN,CLOSED]){totalCount pageInfo{hasNextPage endCursor} nodes{body}}}}")


def fail(message):
    print(f"phase-a-audit: {message}", file=sys.stderr)
    sys.exit(2)


def cited_ids(repo):
    owner, name = repo.split("/")
    read = subprocess.run(["gh", "api", "graphql", "--paginate", "--slurp", "-f", f"query={ISSUES}",
                           "-F", f"owner={owner}", "-F", f"repo={name}"], capture_output=True, text=True)
    if read.returncode != 0:
        fail(f"issue history unreadable (exit {read.returncode}): {read.stderr.strip()[:160]}")
    pages = [page["data"]["repository"]["issues"] for page in json.loads(read.stdout)]
    bodies = [node.get("body") or "" for page in pages for node in page["nodes"]]
    if not pages or len(bodies) != pages[0]["totalCount"]:
        fail(f"issue history incomplete: read {len(bodies)} issues")
    return {i for body in bodies for i in FINDING_ID.findall(body)}


def candidate(finding):
    return {
        "id": finding["id"],
        "title": finding["title"],
        "body": f"Phase A audit finding {finding['id']} ({finding['severity']}, {finding['status']}, "
                f"effort {finding['effort']}). Detail in docs/audits/{finding['document']} on local main, not on GitHub.",
    }


def main(argv):
    if len(argv) != 3 or not REPO.fullmatch(argv[2]):
        fail("usage: phase-a-audit.py <findings.json> <owner/name>")
    try:
        findings = json.loads(Path(argv[1]).read_text())
    except (OSError, ValueError) as error:
        fail(f"findings unreadable: {error}")
    cited = cited_ids(argv[2])
    open_findings = [f for f in findings if not f["id"].upper().startswith("SEC") and f["id"] not in cited]
    print(json.dumps([candidate(f) for f in open_findings]))


if __name__ == "__main__":
    main(sys.argv)
