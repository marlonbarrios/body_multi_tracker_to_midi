#!/bin/bash
# Double-click: start the OSC bridge, so the app can send OSC to TouchDesigner, Max, Pd, etc.
# Leave this window open while you use OSC. Close it (or press Ctrl+C) to stop.
cd "$(dirname "$0")"
python3 osc_bridge.py "$@"
