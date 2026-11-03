#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

load_env_file "${XDG_CONFIG_HOME:-$HOME/.config}/ai-image-generator/.env"
load_env_file "$HOME/.ai-image-generator/.env"
load_env_file "./.env"
load_env_file "${SKILL_DIR}/.env"

status="ok"

if ! command -v jq >/dev/null 2>&1; then
  echo "missing: jq"
  status="error"
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "missing: curl"
  status="error"
fi

if [[ -n "${GPT_IMAGE2_API_KEY:-${YUNWU_GPT_IMAGE2_API_KEY:-${YUNWU_IMAGE2_API_KEY:-${YUNWU_API_KEY:-}}}}" ]]; then
  echo "gpt-image2: configured"
else
  echo "gpt-image2: not fully configured"
fi

if [[ -n "${NANO_BANANA_API_URL:-${YUNWU_NANO_BANANA_API_URL:-${YUNWU_NANO_BANANA_BASE_URL:-${NANO_BANANA_BASE_URL:-${NANOBANANA_API_URL:-}}}}}" && -n "${NANO_BANANA_API_KEY:-${YUNWU_NANO_BANANA_API_KEY:-${YUNWU_API_KEY:-${NANOBANANA_API_KEY:-}}}}" ]]; then
  echo "nano-banana: configured"
else
  echo "nano-banana: not fully configured"
fi

if [[ -n "${SILICONFLOW_IMAGE_API_KEY:-${SILICONFLOW_API_KEY:-}}" ]]; then
  echo "siliconflow-qwen-image: configured"
else
  echo "siliconflow-qwen-image: not fully configured"
fi

if [[ -n "${OPENAI_IMAGE_API_KEY:-${OPENAI_API_KEY:-}}" ]]; then
  echo "openai: configured"
else
  echo "openai: not fully configured"
fi

if [[ "$status" == "error" ]]; then
  exit 1
fi
