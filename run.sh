#!/usr/bin/env bash
# Start the API and the UI on this machine, no containers.
#
#   ./run.sh            # install what's missing, then run both
#   ./run.sh --setup    # only install
#
# Docker is the reliable path (see docker-compose.yml); this one is faster to
# iterate against and renders on your own CPU rather than a container's.
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
VENV="$ROOT/.venv"
SETUP_ONLY=0
[[ "${1:-}" == "--setup" ]] && SETUP_ONLY=1

# Windows venvs put binaries in Scripts/, everyone else in bin/
if [[ -d "$VENV/Scripts" ]]; then BIN="$VENV/Scripts"; else BIN="$VENV/bin"; fi
PY="$BIN/python"

step() { printf '\n\033[38;5;209m==>\033[0m %s\n' "$1"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

command -v python  >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 \
  || die "python 3.10+ is required"
command -v node    >/dev/null 2>&1 || die "node 18+ is required"
PYTHON="$(command -v python || command -v python3)"

if ! command -v ffmpeg >/dev/null 2>&1; then
  printf '\033[33mwarning:\033[0m ffmpeg is not on PATH — renders will fail.\n'
  printf '         winget install Gyan.FFmpeg   |   brew install ffmpeg   |   apt install ffmpeg\n'
fi

if [[ ! -d "$VENV" ]]; then
  step "creating .venv"
  "$PYTHON" -m venv "$VENV"
fi

step "installing python dependencies"
"$PY" -m pip install --quiet --upgrade pip
"$PY" -m pip install --quiet -r backend/requirements.txt

if ! "$PY" -c "
import sys
from playwright.sync_api import sync_playwright
from pathlib import Path
with sync_playwright() as pw:
    sys.exit(0 if Path(pw.chromium.executable_path).exists() else 1)
" 2>/dev/null; then
  step "downloading chromium (once, ~150 MB)"
  "$PY" -m playwright install chromium
fi

if [[ ! -d frontend/node_modules ]]; then
  step "installing frontend dependencies"
  (cd frontend && npm install)
fi

[[ $SETUP_ONLY -eq 1 ]] && { step "setup complete"; exit 0; }

step "starting the API on :8000"
(cd backend && "$BIN/uvicorn" app.main:create_app --factory --reload \
    --host 127.0.0.1 --port 8000) &
API=$!
trap 'kill $API 2>/dev/null || true' EXIT INT TERM

step "starting the UI on http://localhost:5173"
(cd frontend && npm run dev)
