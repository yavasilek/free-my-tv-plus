#!/bin/sh
set -eu

options=/data/options.json
export FMTV_MYSHOWS_LOGIN="$(jq -r .login "$options")"
export FMTV_MYSHOWS_PROFILE_DIR=/data/browser
export FMTV_MYSHOWS_CHROME=chromium

install -d -m 0700 -o pwuser -g pwuser "$FMTV_MYSHOWS_PROFILE_DIR"

export DISPLAY=:99
Xvfb "$DISPLAY" -screen 0 1280x900x24 -nolisten tcp &
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if xdpyinfo >/dev/null 2>&1; then break; fi
    sleep 1
done
xdpyinfo >/dev/null 2>&1

if [ "$(jq -r .login_window "$options")" = true ]; then
    x11vnc -display "$DISPLAY" -localhost -rfbport 5900 -forever -shared -nopw -noxdamage -quiet &
    websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 &
    nginx -g 'daemon off;' &
    exec runuser -u pwuser -- node /app/myshows-browser.mjs --setup
fi

export FMTV_MYSHOWS_BIND=0.0.0.0 FMTV_MYSHOWS_CONTAINER=1
export FMTV_MYSHOWS_ALLOW="$(jq -r .core_ip "$options")"
export FMTV_MYSHOWS_RELAY_KEY="$(jq -r .relay_key "$options")"
if [ "$(jq -r '.catalog_enabled // false' "$options")" = true ]; then
    catalog_key=/config/catalog-key
    if [ ! -s "$catalog_key" ]; then
        (umask 077; node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > "$catalog_key")
    fi
    export FMTV_MYSHOWS_CATALOG_KEY="$(cat "$catalog_key")"
    export FMTV_MYSHOWS_AUTO_MOVIES="$(jq -r '.auto_movies // false' "$options")"
fi
exec runuser -u pwuser -- node /app/myshows-browser.mjs --serve
