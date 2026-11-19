#!/bin/bash
# Double-click: start the local server (if it isn't running) and open Body Multi-Tracker
# in its own Chrome app window.
cd "$(dirname "$0")"
URL=http://localhost:8765
if ! lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  python3 serve.py &
  sleep 1
fi
open -na "Google Chrome" --args --app="$URL" || open "$URL"
wait
