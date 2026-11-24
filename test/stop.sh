#!/bin/bash
W=$1
for f in tb servers; do [ -f "$W/$f.pid" ] && kill "$(cat "$W/$f.pid")" 2>/dev/null; done
exit 0
