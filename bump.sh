#!/bin/sh
# usage: ./bump.sh 12   (sets the app version everywhere: service worker cache, in-app version, script URLs)
set -e
N="$1"; [ -n "$N" ] || { echo "usage: ./bump.sh N"; exit 1; }
sed -i "s/shelf-finder-v[0-9]*/shelf-finder-v$N/" sw.js
sed -i "s/APP_VERSION = 'v[0-9]*'/APP_VERSION = 'v$N'/" app.js
sed -i -E "s/\.(js|css)(\?v=[0-9]+)?\"/.\1?v=$N\"/g" index.html
grep -n "?v=" index.html | head
