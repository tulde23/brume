#!/usr/bin/env bash
# Run the Brume test bench on a connected phone and print its results.
#
#   scripts/run-bench.sh <mode> [ids,comma,separated] [metro-log]
#
# mode: template | marked | whole-page. Needs a development build connected to
# Metro, with Metro's output going to <metro-log>.
set -euo pipefail
export MSYS_NO_PATHCONV=1
MODE="${1:?usage: run-bench.sh <template|marked|whole-page> [ids] [metro-log]}"
ONLY="${2:-}"
LOG="${3:-${METRO_LOG:?set METRO_LOG or pass the metro log path}}"
ADB="${ADB:-adb}"
before=$(grep -c "\[bench-done\]" "$LOG" || true)
$ADB shell svc power stayon usb
$ADB shell input keyevent KEYCODE_WAKEUP
$ADB reverse tcp:8081 tcp:8081 >/dev/null
base="brume://bench?run=$MODE"
[ -n "$ONLY" ] && base="$base&only=$ONLY"
# n is a nonce: the app ignores a link it has already run.
url="$base&n=$(date +%s)"
starts=$(grep -c "\[bench-start\]" "$LOG" || true)
# The app may still be loading (e.g. just installed): resend the link until the run starts.
for attempt in 1 2 3 4 5 6; do
  $ADB shell "am start -a android.intent.action.VIEW -d '$url' com.brume.app" >/dev/null
  for _ in $(seq 1 10); do
    [ "$(grep -c "\[bench-start\]" "$LOG" || true)" -gt "$starts" ] && break 2
    sleep 2
  done
  url="$base&n=$(date +%s)$attempt"
done
until [ "$(grep -c "\[bench-done\]" "$LOG" || true)" -gt "$before" ]; do sleep 3; done
# Every result line since this run started.
awk -v n="$before" '/\[bench-done\]/{d++} d>=n && /\[bench-result\]|\[bench-done\]/' "$LOG" | tail -50
