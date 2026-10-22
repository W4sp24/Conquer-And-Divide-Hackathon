#!/usr/bin/env bash
# One command for demo day (macOS/Linux): build the web app and serve everything on :8000.
set -euo pipefail
cd "$(dirname "$0")/api"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
(cd ../web && { [ -d node_modules ] || npm ci; } && npm run build)
echo "Seller desk: http://localhost:8000/seller  (key: demo-seller-key unless SELLER_KEY is set)"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
