#!/bin/bash
# Pack src/ into dist/tb-chat-<version>.xpi
set -e
cd "$(dirname "$(readlink -f "$0")")"
V=$(python3 -c 'import json; print(json.load(open("src/manifest.json"))["version"])')
mkdir -p dist; rm -f dist/*.xpi
(cd src && zip -q -r -X "../dist/tb-chat-$V.xpi" . -x '.*')
zip -q -X -j "dist/tb-chat-$V.xpi" LICENSE   # the licence travels with every copy
echo "dist/tb-chat-$V.xpi"
