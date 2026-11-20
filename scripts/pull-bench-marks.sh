#!/usr/bin/env bash
# Copy the boxes marked on the phone (bench "Mark boxes") back into the samples folder.
#
#   scripts/pull-bench-marks.sh <samples-dir> [adb-serial]
set -euo pipefail
export MSYS_NO_PATHCONV=1
DEST="${1:?usage: pull-bench-marks.sh <samples-dir> [adb-serial]}"
ADB="${ADB:-adb}"
[ -n "${2:-}" ] && ADB="$ADB -s $2"
for id in $($ADB shell "run-as com.brume.app ls files/bench" | tr -d '\r'); do
  if $ADB shell "run-as com.brume.app test -f files/bench/$id/marked.json" 2>/dev/null; then
    mkdir -p "$DEST/$id"
    $ADB exec-out "run-as com.brume.app cat files/bench/$id/marked.json" > "$DEST/$id/marked.json"
    echo "pulled $id"
  fi
done
