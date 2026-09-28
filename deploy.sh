#!/usr/bin/env bash
# Pull the latest code, rebuild dist/index.js, and restart the API.
#
# Usage:
#   ./deploy.sh                                  # restarts PM2 app $PM2_NAME (default below)
#   RESTART_CMD="pm2 restart be-komisi" ./deploy.sh
#   FORCE=1 ./deploy.sh                          # reinstall & restart even without new commits
#
# Sync jobs (src/job/*.job.ts) run from cron and pick up new code on their next run.

set -euo pipefail

cd "$(dirname "$0")"
APP_DIR=$(pwd)
BUN=${BUN:-$(command -v bun || echo "$HOME/.bun/bin/bun")}
PM2_NAME=${PM2_NAME:-sales-commission-digital-business-v2}

log() { echo "[deploy] $*"; }

restart_app() {
    if [ -n "${RESTART_CMD:-}" ]; then
        log "Restart: $RESTART_CMD"
        eval "$RESTART_CMD"
        return
    fi

    if command -v pm2 >/dev/null 2>&1 && pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
        log "Restart PM2 process: $PM2_NAME"
        pm2 restart "$PM2_NAME"
        return
    fi

    local unit
    unit=$(grep -lE "^WorkingDirectory=$APP_DIR/?$" /etc/systemd/system/*.service 2>/dev/null | head -1 || true)
    if [ -n "$unit" ]; then
        log "Restart systemd service: $(basename "$unit")"
        sudo systemctl restart "$(basename "$unit")"
        return
    fi

    log "Could not find how the API is run (PM2 / systemd). Restart it manually,"
    log "or run again with RESTART_CMD=\"<restart command>\" ./deploy.sh"
    exit 1
}

health_check() {
    local port
    port=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)
    port=${port:-3000}

    for _ in $(seq 1 15); do
        if curl -fsS -o /dev/null "http://127.0.0.1:$port/api/additional/period"; then
            log "API is up on port $port"
            return
        fi
        sleep 1
    done

    log "API did not respond on port $port after 15s, check the logs"
    exit 1
}

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    log "Aborted: there are local changes on the server:"
    git status --short --untracked-files=no
    exit 1
fi

before=$(git rev-parse HEAD)
log "Pulling latest code..."
git pull --ff-only
after=$(git rev-parse HEAD)

if [ "$before" = "$after" ] && [ "${FORCE:-}" != "1" ]; then
    log "Already up to date ($(git log -1 --format='%h %s'))"
    exit 0
fi

git log --oneline "$before..$after"

if [ "${FORCE:-}" = "1" ] || git diff --name-only "$before" "$after" | grep -qE '^(package\.json|bun\.lock)$'; then
    log "Installing dependencies..."
    "$BUN" install --frozen-lockfile
fi

# PM2 runs the bundled dist/index.js, not src/, so rebuild before restarting
log "Building dist/index.js..."
"$BUN" run build

restart_app
health_check
log "Done: $(git log -1 --format='%h %s')"
