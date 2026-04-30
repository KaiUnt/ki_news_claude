#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f .env ]; then
  echo "ERROR: .env nicht gefunden. Bitte .env.example kopieren und ANTHROPIC_API_KEY setzen."
  exit 1
fi

if [ ! -d .venv ]; then
  echo "Erstelle virtuelles Environment..."
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi

echo "Starte KI-News Backend auf http://localhost:8000"
echo "API Docs: http://localhost:8000/docs"
.venv/bin/uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
