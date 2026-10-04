#!/usr/bin/env bash
set -euo pipefail

: "${MODEL_PATH:?请设置真一合并版模型目录 MODEL_PATH}"

SWIFT_BIN=${SWIFT_BIN:-swift}
MODEL_HOST=${MODEL_HOST:-127.0.0.1}
MODEL_PORT=${MODEL_PORT:-8000}
ZHENYI_MODEL_NAME=${ZHENYI_MODEL_NAME:-ZHENYI}

test -f "$MODEL_PATH/config.json"
test -f "$MODEL_PATH/model.safetensors.index.json"

exec "$SWIFT_BIN" deploy \
  --model "$MODEL_PATH" \
  --model_type qwen3_5 \
  --template qwen3_8 \
  --infer_backend transformers \
  --torch_dtype bfloat16 \
  --served_model_name "$ZHENYI_MODEL_NAME" \
  --enable_thinking false \
  --host "$MODEL_HOST" \
  --port "$MODEL_PORT" \
  --max_new_tokens 1600
