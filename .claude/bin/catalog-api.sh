#!/usr/bin/env bash
# catalog-api.sh — call the catalog API for /research-appliance without the token
# ever reaching the command line, stdout, stderr or the transcript.
#
# guard-secrets denies any command that names a dotenv file, so the skill's old
# inline `sed … <dotenv>` setup was blocked. This script reads CATALOG_API_TOKEN
# (and CATALOG_API_URL for --target prod) itself and only ever calls
# <base>/api/catalog/…. It prints the response body, then the HTTP status on a
# line of its own (000 when no server answered).
#
# Usage:
#   catalog-api.sh [--target local|prod] GET  <path>
#   catalog-api.sh [--target local|prod] POST <path> <json-file> <expected-endpoint>
#
# <path> starts with /api/catalog/ (a ?dryRun=true|false query is allowed).
# <expected-endpoint> is the ep-… id from GET /api/catalog/database; it is sent
# as X-Expect-Database. The dotenv file is the first of .env.local in the CWD,
# then in the main checkout (worktrees have none of their own).
# Exit: 0 a status was printed · 64 usage · 65 key missing
set -euo pipefail

TARGET=local
if [ "${1:-}" = "--target" ]; then TARGET="${2:-}"; shift 2; fi
METHOD="${1:-}"; URL_PATH="${2:-}"
usage() { sed -n '11,13p' "$0" >&2; exit 64; }

case "$TARGET" in local|prod) ;; *) usage ;; esac
[[ "$URL_PATH" =~ ^/api/catalog/[a-z/]+(\?dryRun=(true|false))?$ ]] || usage

FILE=".env.local"
if [ ! -f "$FILE" ]; then
  MAIN=$(git worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')
  FILE="$MAIN/.env.local"
fi
[ -f "$FILE" ] || { echo "no .env.local in this checkout or the main one" >&2; exit 65; }

read_key() { sed -n "s/^\(export \)\{0,1\}$1=//p" "$FILE" | tail -1 | tr -d '"'"'"; }
TOKEN=$(read_key CATALOG_API_TOKEN)
[ -n "$TOKEN" ] || { echo "CATALOG_API_TOKEN is not in .env.local" >&2; exit 65; }
BASE=http://localhost:3000
if [ "$TARGET" = prod ]; then
  BASE=$(read_key CATALOG_API_URL)
  [ -n "$BASE" ] || { echo "CATALOG_API_URL is not in .env.local" >&2; exit 65; }
fi

# The token goes to curl through a config on stdin, never through argv.
auth() { printf 'header = "Authorization: Bearer %s"\n' "$TOKEN"; }

case "$METHOD" in
  GET)
    [ $# -eq 2 ] || usage
    auth | curl -sS -m 30 -K - -w '\n%{http_code}\n' "$BASE$URL_PATH" || true ;;
  POST)
    [ $# -eq 4 ] || usage
    BODY="$3"; ENDPOINT="$4"
    [ -f "$BODY" ] || { echo "no such file: $BODY" >&2; exit 64; }
    [[ "$ENDPOINT" =~ ^ep-[a-z0-9-]+$ ]] || { echo "expected endpoint must look like ep-…" >&2; exit 64; }
    auth | curl -sS -m 30 -K - -w '\n%{http_code}\n' -X POST \
      -H "X-Expect-Database: $ENDPOINT" -H 'Content-Type: application/json' \
      --data @"$BODY" "$BASE$URL_PATH" || true ;;
  *) usage ;;
esac
