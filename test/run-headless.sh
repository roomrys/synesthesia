#!/usr/bin/env bash
# Run the browser tests in headless Chrome and print the results.
# Usage: test/run-headless.sh [port]
set -euo pipefail

PORT="${1:-8765}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
cleanup() {
    kill "${BROWSER:-}" "${SERVER:-}" 2>/dev/null || true
    wait 2>/dev/null || true
    rm -rf "$TMP" 2>/dev/null || true
}
trap cleanup EXIT

(cd "$ROOT" && python3 -m http.server "$PORT" >/dev/null 2>&1) &
SERVER=$!
sleep 1

"$CHROME" --headless=new --disable-gpu --autoplay-policy=no-user-gesture-required \
    --user-data-dir="$TMP/profile" --enable-logging=stderr --v=0 \
    "http://localhost:$PORT/test/run.html" 2>"$TMP/log" &
BROWSER=$!

for _ in $(seq 1 180); do
    if grep -q "TESTS DONE" "$TMP/log" 2>/dev/null; then break; fi
    sleep 1
done

# Console output arrives as one log entry; print the lines between the markers.
awk '/TEST RESULTS/{on=1; next} /TESTS DONE/{on=0} on' "$TMP/log" | sed 's/", source: .*//'
grep -q "TESTS DONE" "$TMP/log" || { echo "Timed out. Last log lines:"; tail -20 "$TMP/log"; exit 1; }
! grep -q "^FAIL\|[1-9][0-9]* failed" <(awk '/TEST RESULTS/{on=1; next} /TESTS DONE/{on=0} on' "$TMP/log")
