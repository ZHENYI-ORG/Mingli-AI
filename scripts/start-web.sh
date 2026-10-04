#!/usr/bin/env bash
set -euo pipefail

export ZHENYI_MODEL_BASE_URL=${ZHENYI_MODEL_BASE_URL:-http://127.0.0.1:8000/v1}
export ZHENYI_MODEL_NAME=${ZHENYI_MODEL_NAME:-ZHENYI}
export HOST=${HOST:-0.0.0.0}
export PORT=${PORT:-8787}

exec node dist/server.js
