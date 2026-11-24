#!/bin/bash
# Start fake servers + a headless Thunderbird on a fresh throw-away profile.
# usage: [TB_BIN=/path/to/other/thunderbird] test/start.sh <workdir> [filler-count]
set -e
W=$1; FILLER=${2:-0}
HERE=$(dirname "$(readlink -f "$0")")
POP=11110; SMTP=11125; MPORT=${MPORT:-2829}
rm -rf "$W"; mkdir -p "$W/profile" "$W/spool-hold" "$W/spool" "$W/out"
python3 "$HERE/mkprofile.py" "$W/profile" "$W/spool-hold" $POP $SMTP "$FILLER"
echo "user_pref(\"marionette.port\", $MPORT);" >> "$W/profile/user.js"
nohup python3 "$HERE/fakeservers.py" "$W/spool" "$W/out" $POP $SMTP > "$W/servers.log" 2>&1 &
echo $! > "$W/servers.pid"
MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 MOZ_HEADLESS=1 MOZ_HEADLESS_WIDTH=1400 MOZ_HEADLESS_HEIGHT=1000 nohup "${TB_BIN:-thunderbird}" --no-remote --new-instance --profile "$W/profile" --marionette --remote-allow-system-access > "$W/tb.log" 2>&1 &
echo $! > "$W/tb.pid"
for i in $(seq 1 60); do (echo > /dev/tcp/127.0.0.1/$MPORT) 2>/dev/null && { echo "marionette up on $MPORT"; exit 0; }; sleep 1; done
echo "marionette did not come up"; tail -20 "$W/tb.log"; exit 1
