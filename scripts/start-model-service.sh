#!/usr/bin/env bash
set -euo pipefail

: "${BASE_MODEL_PATH:?请设置 Qwen3.8-27B 原始模型目录 BASE_MODEL_PATH}"
: "${ADAPTER_PATH:?请设置真一 LoRA 检查点目录 ADAPTER_PATH}"

SWIFT_BIN=${SWIFT_BIN:-swift}
MODEL_HOST=${MODEL_HOST:-127.0.0.1}
MODEL_PORT=${MODEL_PORT:-8000}
ZHENYI_MODEL_NAME=${ZHENYI_MODEL_NAME:-ZHENYI}

test -f "$BASE_MODEL_PATH/config.json"
test -f "$ADAPTER_PATH/adapter_config.json"

exec "$SWIFT_BIN" deploy \
  --model "$BASE_MODEL_PATH" \
  --model_type qwen3_5 \
  --template qwen3_8 \
  --adapters "$ADAPTER_PATH" \
  --infer_backend transformers \
  --torch_dtype bfloat16 \
  --served_model_name "$ZHENYI_MODEL_NAME" \
  --enable_thinking false \
  --host "$MODEL_HOST" \
  --port "$MODEL_PORT" \
  --max_new_tokens 1600
