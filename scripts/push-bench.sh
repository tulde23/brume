#!/usr/bin/env bash
# Copy test-bench sample pages onto a phone running a development build of InkStat.
#
#   scripts/push-bench.sh <samples-dir>[,<samples-dir>...] [adb-serial]
#
#   e.g. scripts/push-bench.sh "D:/Development/Private/brume-bench-samples,D:/Development/Private/inkstat-test-league/bench"
#
# Each <samples-dir> holds one folder per sample: page.(jpg|png) + truth.json (see
# packages/basketball/src/bench.ts). Samples stay OUT of this public repo: some
# pages carry minors' names or are not ours to publish.
set -euo pipefail
# Git Bash on Windows would rewrite the phone-side paths (/data/...) into Windows paths.
export MSYS_NO_PATHCONV=1
local_path() { command -v cygpath >/dev/null && cygpath -w "$1" || echo "$1"; }
SRC="${1:?usage: push-bench.sh <samples-dir>[,<samples-dir>...] [adb-serial]}"
ADB="${ADB:-adb}"
[ -n "${2:-}" ] && ADB="$ADB -s $2"
PKG=com.inkstat.app
TMP=/data/local/tmp/inkstat-bench

$ADB shell rm -rf "$TMP"
$ADB shell mkdir -p "$TMP"
IFS=',' read -r -a SOURCES <<< "$SRC"
for src in "${SOURCES[@]}"; do
for dir in "$src"/*/; do
  id=$(basename "$dir")
  $ADB shell mkdir -p "$TMP/$id"
  for f in "$dir"page.* "$dir"truth.json "$dir"marked.json; do
    [ -f "$f" ] && $ADB push "$(local_path "$f")" "$TMP/$id/" >/dev/null
  done
  echo "pushed $id"
done
done
# Into the app's private files (needs a debuggable build).
$ADB shell "run-as $PKG sh -c 'rm -rf files/bench && mkdir -p files/bench && cp -r $TMP/* files/bench/'"
$ADB shell rm -rf "$TMP"
echo "done: open InkStat, hold the logo on Home, run the bench"
