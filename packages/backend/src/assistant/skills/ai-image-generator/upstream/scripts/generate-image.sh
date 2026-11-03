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

PROVIDER="${IMAGE_PROVIDER:-auto}"
PROMPT=""
ASPECT_RATIO="1:1"
ASPECT_RATIO_SET_BY_CLI="false"
SIZE="${OPENAI_IMAGE_SIZE:-1024x1024}"
SIZE_SET_BY_CLI="false"
QUALITY="${OPENAI_IMAGE_QUALITY:-auto}"
OUTPUT_FORMAT="${OPENAI_IMAGE_FORMAT:-png}"
NUM_IMAGES="${IMAGE_NUM_IMAGES:-1}"
TIMEOUT="${IMAGE_API_TIMEOUT:-180}"
OUTPUT_DIR="."
OUTPUT_PREFIX="ai_image"
IMAGE_SPEC_JSON='{"source":"provider_default","asset_type":null,"matched_keywords":[],"size":null,"aspect_ratio":null,"provider_aspect_ratio":null}'
INPUT_IMAGES=()
INPUT_IMAGE_COUNT=0

usage() {
  cat <<'EOF'
Usage:
  bash scripts/generate-image.sh --provider auto --prompt "..." [options]
  bash scripts/generate-image.sh --provider gpt-image2 --prompt "..." [options]
  bash scripts/generate-image.sh --provider nano-banana --prompt "..." [options]
  bash scripts/generate-image.sh --provider siliconflow-qwen-image --prompt "..." [options]
  bash scripts/generate-image.sh --provider openai --prompt "..." [options]

Options:
  --provider NAME          auto, gpt-image2, nano-banana, siliconflow-qwen-image, or openai. Default: auto.
  --prompt TEXT            Required generation or edit prompt.
  --input-image PATH       Optional reference image. Can be repeated.
  --aspect-ratio RATIO     Nano Banana aspect ratio. Default: 1:1.
  --size SIZE              Provider image size. Default: 1024x1024.
  --quality VALUE          OpenAI quality. Default: auto.
  --output-format FORMAT   OpenAI output format. Default: png.
  --num-images N           Number of images. Default: 1.
  --timeout SECONDS        API timeout. Default: 180.
  --output-dir DIR         Output directory. Default: current directory.
  --output-prefix PREFIX   Output filename prefix. Default: ai_image.
EOF
}

mime_type_for() {
  local path="$1"
  case "${path##*.}" in
    jpg|JPG|jpeg|JPEG) printf 'image/jpeg' ;;
    png|PNG) printf 'image/png' ;;
    webp|WEBP) printf 'image/webp' ;;
    gif|GIF) printf 'image/gif' ;;
    *) printf 'application/octet-stream' ;;
  esac
}

base64_file() {
  local path="$1"
  if base64 --help 2>&1 | grep -q -- '-w'; then
    base64 -w 0 "$path"
  else
    base64 < "$path" | tr -d '\n'
  fi
}

decode_base64_to_file() {
  local data="$1"
  local output_path="$2"
  printf '%s' "$data" | base64 -d > "$output_path" 2>/dev/null || printf '%s' "$data" | base64 -D > "$output_path"
}

absolute_path() {
  local path="$1"
  printf '%s/%s' "$(cd "$(dirname "$path")" && pwd)" "$(basename "$path")"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider)
      PROVIDER="${2:-}"
      shift 2
      ;;
    --prompt)
      PROMPT="${2:-}"
      shift 2
      ;;
    --input-image)
      INPUT_IMAGES+=("${2:-}")
      INPUT_IMAGE_COUNT=$((INPUT_IMAGE_COUNT + 1))
      shift 2
      ;;
    --aspect-ratio)
      ASPECT_RATIO="${2:-}"
      ASPECT_RATIO_SET_BY_CLI="true"
      shift 2
      ;;
    --size)
      SIZE="${2:-}"
      SIZE_SET_BY_CLI="true"
      shift 2
      ;;
    --quality)
      QUALITY="${2:-}"
      shift 2
      ;;
    --output-format)
      OUTPUT_FORMAT="${2:-}"
      shift 2
      ;;
    --num-images)
      NUM_IMAGES="${2:-}"
      shift 2
      ;;
    --timeout)
      TIMEOUT="${2:-}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:-}"
      shift 2
      ;;
    --output-prefix)
      OUTPUT_PREFIX="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PROMPT" ]]; then
  echo "Missing required --prompt." >&2
  usage >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Missing dependency: jq." >&2
  exit 1
fi

resolve_image_spec_if_needed() {
  if [[ "$SIZE_SET_BY_CLI" == "true" || "$ASPECT_RATIO_SET_BY_CLI" == "true" ]]; then
    local resolver_args=(--query "$PROMPT")
    if [[ "$SIZE_SET_BY_CLI" == "true" ]]; then
      resolver_args+=(--size "$SIZE")
    fi
    if [[ "$ASPECT_RATIO_SET_BY_CLI" == "true" ]]; then
      resolver_args+=(--aspect-ratio "$ASPECT_RATIO")
    fi
    IMAGE_SPEC_JSON="$(bash "${SCRIPT_DIR}/resolve-image-spec.sh" "${resolver_args[@]}")"
    return
  fi

  IMAGE_SPEC_JSON="$(bash "${SCRIPT_DIR}/resolve-image-spec.sh" --query "$PROMPT")"

  local resolved_size
  local resolved_ratio
  resolved_size="$(jq -r '.size // empty' <<<"$IMAGE_SPEC_JSON")"
  resolved_ratio="$(jq -r '.provider_aspect_ratio // .aspect_ratio // empty' <<<"$IMAGE_SPEC_JSON")"

  if [[ -n "$resolved_size" ]]; then
    SIZE="$resolved_size"
    SIZE_SET_BY_CLI="true"
  fi

  if [[ -n "$resolved_ratio" ]]; then
    ASPECT_RATIO="$resolved_ratio"
    ASPECT_RATIO_SET_BY_CLI="true"
  fi
}

resolve_image_spec_if_needed

mkdir -p "$OUTPUT_DIR"
timestamp="$(date +%Y%m%d_%H%M%S)"
raw_json_path="${OUTPUT_DIR%/}/${OUTPUT_PREFIX}_${timestamp}_response.json"

validate_input_images() {
  if [[ "$INPUT_IMAGE_COUNT" -gt 0 ]]; then
    for image_path in "${INPUT_IMAGES[@]}"; do
      if [[ ! -f "$image_path" ]]; then
        echo "Input image not found: $image_path" >&2
        exit 1
      fi
      if [[ "$(mime_type_for "$image_path")" == "application/octet-stream" ]]; then
        echo "Unsupported or unknown image type: $image_path" >&2
        exit 1
      fi
    done
  fi
}

normalize_nano_aspect_ratio() {
  case "$ASPECT_RATIO" in
    2.35:1|2.35|900:383|900x383)
      ASPECT_RATIO="21:9"
      ;;
  esac
}

save_inline_images_from_json() {
  local response_path="$1"
  local rows_path="${OUTPUT_DIR%/}/${OUTPUT_PREFIX}_${timestamp}_images.tsv"
  jq -r '
    [
      .. |
      objects |
      (.inline_data? // .inlineData?) |
      select(type == "object" and (.data? | type == "string")) |
      [(.mime_type // .mimeType // "image/png"), .data] |
      @tsv
    ][]?
  ' "$response_path" > "$rows_path"

  if [[ ! -s "$rows_path" ]]; then
    jq -n --arg raw_json "$(absolute_path "$response_path")" \
      '{status: "error", error: "API response did not contain image data.", images: [], raw_json: $raw_json}'
    exit 2
  fi

  images_json="[]"
  index=1
  while IFS=$'\t' read -r mime_type image_data; do
    case "$mime_type" in
      image/jpeg) ext="jpg" ;;
      image/png) ext="png" ;;
      image/webp) ext="webp" ;;
      image/gif) ext="gif" ;;
      *) ext="png" ;;
    esac
    output_path="${OUTPUT_DIR%/}/${OUTPUT_PREFIX}_${timestamp}_${index}.${ext}"
    decode_base64_to_file "$image_data" "$output_path"
    images_json="$(jq -n --argjson images "$images_json" --arg path "$(absolute_path "$output_path")" '$images + [$path]')"
    index=$((index + 1))
  done < "$rows_path"
  rm -f "$rows_path"

  jq -n --arg provider "$PROVIDER" --argjson images "$images_json" --arg raw_json "$(absolute_path "$response_path")" --argjson image_spec "$IMAGE_SPEC_JSON" \
    '{status: "success", provider: $provider, images: $images, raw_json: $raw_json, image_spec: $image_spec}'
}

save_openai_images_from_json() {
  local response_path="$1"
  local rows_path="${OUTPUT_DIR%/}/${OUTPUT_PREFIX}_${timestamp}_openai.tsv"
  jq -r '[.data[]? | select(.b64_json? != null) | [.b64_json] | @tsv][]?' "$response_path" > "$rows_path"

  if [[ ! -s "$rows_path" ]]; then
    rm -f "$rows_path"
    return 1
  fi

  images_json="[]"
  index=1
  while IFS=$'\t' read -r image_data; do
    output_path="${OUTPUT_DIR%/}/${OUTPUT_PREFIX}_${timestamp}_${index}.${OUTPUT_FORMAT}"
    decode_base64_to_file "$image_data" "$output_path"
    images_json="$(jq -n --argjson images "$images_json" --arg path "$(absolute_path "$output_path")" '$images + [$path]')"
    index=$((index + 1))
  done < "$rows_path"
  rm -f "$rows_path"

  jq -n --arg provider "$PROVIDER" --argjson images "$images_json" --arg raw_json "$(absolute_path "$response_path")" --argjson image_spec "$IMAGE_SPEC_JSON" \
    '{status: "success", provider: $provider, images: $images, raw_json: $raw_json, image_spec: $image_spec}'
}

save_openai_url_images_from_json() {
  local response_path="$1"
  local rows_path="${OUTPUT_DIR%/}/${OUTPUT_PREFIX}_${timestamp}_openai_urls.tsv"
  jq -r '[.data[]? | select(.url? != null) | [.url] | @tsv][]?' "$response_path" > "$rows_path"

  if [[ ! -s "$rows_path" ]]; then
    return 1
  fi

  images_json="[]"
  index=1
  while IFS=$'\t' read -r image_url; do
    output_path="${OUTPUT_DIR%/}/${OUTPUT_PREFIX}_${timestamp}_${index}.${OUTPUT_FORMAT}"
    curl -L -sS --max-time "$TIMEOUT" "$image_url" -o "$output_path"
    images_json="$(jq -n --argjson images "$images_json" --arg path "$(absolute_path "$output_path")" '$images + [$path]')"
    index=$((index + 1))
  done < "$rows_path"
  rm -f "$rows_path"

  jq -n --arg provider "$PROVIDER" --argjson images "$images_json" --arg raw_json "$(absolute_path "$response_path")" --argjson image_spec "$IMAGE_SPEC_JSON" \
    '{status: "success", provider: $provider, images: $images, raw_json: $raw_json, image_spec: $image_spec}'
}

openai_compatible_endpoint() {
  local base_url="$1"
  local endpoint="$2"
  base_url="${base_url%/}"
  case "$base_url" in
    */v1/images/generations)
      if [[ "$endpoint" == "generations" ]]; then
        printf '%s' "$base_url"
      else
        printf '%s/edits' "${base_url%/generations}"
      fi
      ;;
    */v1/images/edits)
      if [[ "$endpoint" == "edits" ]]; then
        printf '%s' "$base_url"
      else
        printf '%s/generations' "${base_url%/edits}"
      fi
      ;;
    */v1)
      printf '%s/images/%s' "$base_url" "$endpoint"
      ;;
    *)
      printf '%s/v1/images/%s' "$base_url" "$endpoint"
      ;;
  esac
}

save_siliconflow_images_from_json() {
  local response_path="$1"
  local rows_path="${OUTPUT_DIR%/}/${OUTPUT_PREFIX}_${timestamp}_siliconflow_urls.tsv"
  jq -r '[.images[]? | select(.url? != null) | [.url] | @tsv][]?' "$response_path" > "$rows_path"

  if [[ ! -s "$rows_path" ]]; then
    jq -n --arg raw_json "$(absolute_path "$response_path")" \
      '{status: "error", error: "SiliconFlow response did not contain images[].url.", images: [], raw_json: $raw_json}'
    exit 2
  fi

  images_json="[]"
  index=1
  while IFS=$'\t' read -r image_url; do
    output_path="${OUTPUT_DIR%/}/${OUTPUT_PREFIX}_${timestamp}_${index}.${OUTPUT_FORMAT}"
    curl -L -sS --max-time "$TIMEOUT" "$image_url" -o "$output_path"
    images_json="$(jq -n --argjson images "$images_json" --arg path "$(absolute_path "$output_path")" '$images + [$path]')"
    index=$((index + 1))
  done < "$rows_path"
  rm -f "$rows_path"

  jq -n --arg provider "$PROVIDER" --argjson images "$images_json" --arg raw_json "$(absolute_path "$response_path")" --argjson image_spec "$IMAGE_SPEC_JSON" \
    '{status: "success", provider: $provider, images: $images, raw_json: $raw_json, image_spec: $image_spec}'
}

generate_nano_banana() {
  local api_url="${NANO_BANANA_API_URL:-${YUNWU_NANO_BANANA_API_URL:-${NANOBANANA_API_URL:-}}}"
  local base_url="${YUNWU_NANO_BANANA_BASE_URL:-${NANO_BANANA_BASE_URL:-}}"
  local model="${YUNWU_NANO_BANANA_MODEL:-${NANO_BANANA_MODEL:-gemini-3.1-flash-image-preview}}"
  local api_key="${NANO_BANANA_API_KEY:-${YUNWU_NANO_BANANA_API_KEY:-${YUNWU_API_KEY:-${NANOBANANA_API_KEY:-}}}}"

  if [[ -z "$api_url" && -n "$base_url" ]]; then
    base_url="${base_url%/}"
    case "$base_url" in
      *:generateContent)
        api_url="$base_url"
        ;;
      */v1beta|*/v1)
        api_url="${base_url}/models/${model}:generateContent"
        ;;
      *)
        api_url="${base_url}/v1beta/models/${model}:generateContent"
        ;;
    esac
  fi

  if [[ -z "$api_url" ]]; then
    echo "Missing Nano Banana API URL. Set NANO_BANANA_API_URL, YUNWU_NANO_BANANA_API_URL, or YUNWU_NANO_BANANA_BASE_URL." >&2
    exit 1
  fi
  if [[ -z "$api_key" ]]; then
    echo "Missing Nano Banana API key. Set NANO_BANANA_API_KEY, YUNWU_NANO_BANANA_API_KEY, or YUNWU_API_KEY." >&2
    exit 1
  fi

  validate_input_images
  normalize_nano_aspect_ratio

  parts_json="$(jq -n --arg text "$PROMPT" '[{"text": $text}]')"
  if [[ "$INPUT_IMAGE_COUNT" -gt 0 ]]; then
    for image_path in "${INPUT_IMAGES[@]}"; do
      mime_type="$(mime_type_for "$image_path")"
      image_b64="$(base64_file "$image_path")"
      image_part="$(jq -n --arg data "$image_b64" --arg mime_type "$mime_type" '{inline_data: {data: $data, mime_type: $mime_type}}')"
      parts_json="$(jq -n --argjson image_part "$image_part" --argjson parts "$parts_json" '[$image_part] + $parts')"
    done
  fi

  payload="$(jq -n \
    --argjson parts "$parts_json" \
    --arg aspect_ratio "$ASPECT_RATIO" \
    '{
      contents: [{parts: $parts}],
      generationConfig: {
        imageConfig: {aspectRatio: $aspect_ratio},
        responseModalities: ["TEXT", "IMAGE"]
      }
    }')"

  curl -sS "$api_url" \
    --max-time "$TIMEOUT" \
    -H "Authorization: Bearer ${api_key}" \
    -H "Content-Type: application/json" \
    -d "$payload" > "$raw_json_path"

  if jq -e '.error' "$raw_json_path" >/dev/null 2>&1; then
    jq -n --arg provider "$PROVIDER" --arg error "$(jq -c '.error' "$raw_json_path")" --arg raw_json "$(absolute_path "$raw_json_path")" \
      '{status: "error", provider: $provider, error: $error, raw_json: $raw_json}'
    exit 1
  fi

  save_inline_images_from_json "$raw_json_path"
}

generate_siliconflow_qwen_image() {
  local api_key="${SILICONFLOW_IMAGE_API_KEY:-${SILICONFLOW_API_KEY:-}}"
  local model="${SILICONFLOW_IMAGE_MODEL:-${SILICONFLOW_MODEL:-Qwen/Qwen-Image}}"
  local base_url="${SILICONFLOW_IMAGE_BASE_URL:-${SILICONFLOW_BASE_URL:-https://api.siliconflow.cn/v1/images/generations}}"
  local image_size="$SIZE"
  local steps="${SILICONFLOW_NUM_INFERENCE_STEPS:-20}"
  local guidance="${SILICONFLOW_GUIDANCE_SCALE:-7.5}"

  if [[ "$SIZE_SET_BY_CLI" != "true" && -n "${SILICONFLOW_IMAGE_SIZE:-}" ]]; then
    image_size="$SILICONFLOW_IMAGE_SIZE"
  fi

  if [[ -z "$api_key" ]]; then
    echo "Missing SiliconFlow API key. Set SILICONFLOW_IMAGE_API_KEY or SILICONFLOW_API_KEY." >&2
    exit 1
  fi

  if [[ "$INPUT_IMAGE_COUNT" -gt 0 ]]; then
    echo "SiliconFlow Qwen/Qwen-Image text-to-image path does not support --input-image in this script." >&2
    exit 1
  fi

  case "$base_url" in
    */v1/images/generations) ;;
    */) base_url="${base_url%/}/v1/images/generations" ;;
    *) base_url="${base_url}/v1/images/generations" ;;
  esac

  payload="$(jq -n \
    --arg model "$model" \
    --arg prompt "$PROMPT" \
    --arg image_size "$image_size" \
    --argjson batch_size "$NUM_IMAGES" \
    --argjson steps "$steps" \
    --argjson guidance "$guidance" \
    '{
      model: $model,
      prompt: $prompt,
      image_size: $image_size,
      batch_size: $batch_size,
      num_inference_steps: $steps,
      guidance_scale: $guidance
    }')"

  curl -sS "$base_url" \
    --max-time "$TIMEOUT" \
    -H "Authorization: Bearer ${api_key}" \
    -H "Content-Type: application/json" \
    -d "$payload" > "$raw_json_path"

  if jq -e '.error' "$raw_json_path" >/dev/null 2>&1; then
    jq -n --arg provider "$PROVIDER" --arg error "$(jq -c '.error' "$raw_json_path")" --arg raw_json "$(absolute_path "$raw_json_path")" \
      '{status: "error", provider: $provider, error: $error, raw_json: $raw_json}'
    exit 1
  fi

  save_siliconflow_images_from_json "$raw_json_path"
}

generate_gpt_image2() {
  local api_key="${GPT_IMAGE2_API_KEY:-${YUNWU_GPT_IMAGE2_API_KEY:-${YUNWU_IMAGE2_API_KEY:-${YUNWU_API_KEY:-}}}}"
  local model="${GPT_IMAGE2_MODEL:-${YUNWU_GPT_IMAGE2_MODEL:-gpt-image-2-all}}"
  local base_url="${GPT_IMAGE2_BASE_URL:-${YUNWU_GPT_IMAGE2_BASE_URL:-https://yunwu.ai}}"
  local generate_url="${GPT_IMAGE2_GENERATE_URL:-$(openai_compatible_endpoint "$base_url" "generations")}"
  local edit_url="${GPT_IMAGE2_EDIT_URL:-$(openai_compatible_endpoint "$base_url" "edits")}"

  if [[ -z "$api_key" ]]; then
    echo "Missing GPT-image2 API key. Set GPT_IMAGE2_API_KEY, YUNWU_GPT_IMAGE2_API_KEY, or YUNWU_API_KEY." >&2
    exit 1
  fi

  validate_input_images

  if [[ "$INPUT_IMAGE_COUNT" -gt 0 ]]; then
    curl_args=(-sS --max-time "$TIMEOUT" "$edit_url" -H "Authorization: Bearer ${api_key}" -F "model=${model}" -F "prompt=${PROMPT}" -F "size=${SIZE}" -F "quality=${QUALITY}" -F "output_format=${OUTPUT_FORMAT}")
    for image_path in "${INPUT_IMAGES[@]}"; do
      curl_args+=(-F "image[]=@${image_path}")
    done
    curl "${curl_args[@]}" > "$raw_json_path"
  else
    payload="$(jq -n \
      --arg model "$model" \
      --arg prompt "$PROMPT" \
      --arg size "$SIZE" \
      --arg quality "$QUALITY" \
      --arg output_format "$OUTPUT_FORMAT" \
      --argjson n "$NUM_IMAGES" \
      '{model: $model, prompt: $prompt, size: $size, quality: $quality, output_format: $output_format, n: $n}')"

    curl -sS "$generate_url" \
      --max-time "$TIMEOUT" \
      -H "Authorization: Bearer ${api_key}" \
      -H "Content-Type: application/json" \
      -d "$payload" > "$raw_json_path"
  fi

  if jq -e '.error' "$raw_json_path" >/dev/null 2>&1; then
    jq -n --arg provider "$PROVIDER" --arg error "$(jq -c '.error' "$raw_json_path")" --arg raw_json "$(absolute_path "$raw_json_path")" \
      '{status: "error", provider: $provider, error: $error, raw_json: $raw_json}'
    exit 1
  fi

  save_openai_images_from_json "$raw_json_path" || save_openai_url_images_from_json "$raw_json_path" || {
    jq -n --arg raw_json "$(absolute_path "$raw_json_path")" \
      '{status: "error", error: "GPT-image2 response did not contain b64_json or url image data.", images: [], raw_json: $raw_json}'
    exit 2
  }
}

generate_openai() {
  local api_key="${OPENAI_IMAGE_API_KEY:-${OPENAI_API_KEY:-}}"
  local model="${OPENAI_IMAGE_MODEL:-gpt-image-1.5}"
  local generate_url="${OPENAI_IMAGE_GENERATE_URL:-https://api.openai.com/v1/images/generations}"
  local edit_url="${OPENAI_IMAGE_EDIT_URL:-https://api.openai.com/v1/images/edits}"

  if [[ -z "$api_key" ]]; then
    echo "Missing OpenAI image API key. Set OPENAI_IMAGE_API_KEY." >&2
    exit 1
  fi

  validate_input_images

  if [[ "$INPUT_IMAGE_COUNT" -gt 0 ]]; then
    curl_args=(-sS --max-time "$TIMEOUT" "$edit_url" -H "Authorization: Bearer ${api_key}" -F "model=${model}" -F "prompt=${PROMPT}" -F "size=${SIZE}" -F "quality=${QUALITY}" -F "output_format=${OUTPUT_FORMAT}")
    for image_path in "${INPUT_IMAGES[@]}"; do
      curl_args+=(-F "image[]=@${image_path}")
    done
    curl "${curl_args[@]}" > "$raw_json_path"
  else
    payload="$(jq -n \
      --arg model "$model" \
      --arg prompt "$PROMPT" \
      --arg size "$SIZE" \
      --arg quality "$QUALITY" \
      --arg output_format "$OUTPUT_FORMAT" \
      --argjson n "$NUM_IMAGES" \
      '{model: $model, prompt: $prompt, size: $size, quality: $quality, output_format: $output_format, n: $n}')"

    curl -sS "$generate_url" \
      --max-time "$TIMEOUT" \
      -H "Authorization: Bearer ${api_key}" \
      -H "Content-Type: application/json" \
      -d "$payload" > "$raw_json_path"
  fi

  if jq -e '.error' "$raw_json_path" >/dev/null 2>&1; then
    jq -n --arg provider "$PROVIDER" --arg error "$(jq -c '.error' "$raw_json_path")" --arg raw_json "$(absolute_path "$raw_json_path")" \
      '{status: "error", provider: $provider, error: $error, raw_json: $raw_json}'
    exit 1
  fi

  save_openai_images_from_json "$raw_json_path" || save_openai_url_images_from_json "$raw_json_path" || {
    jq -n --arg raw_json "$(absolute_path "$raw_json_path")" \
      '{status: "error", error: "OpenAI response did not contain b64_json or url image data.", images: [], raw_json: $raw_json}'
    exit 2
  }
}

generate_auto() {
  local providers=(gpt-image2 nano-banana siliconflow-qwen-image openai)
  local provider
  local last_status=0
  local args_base=(--prompt "$PROMPT" --aspect-ratio "$ASPECT_RATIO" --quality "$QUALITY" --output-format "$OUTPUT_FORMAT" --num-images "$NUM_IMAGES" --timeout "$TIMEOUT" --output-dir "$OUTPUT_DIR" --output-prefix "$OUTPUT_PREFIX")
  if [[ "$SIZE_SET_BY_CLI" == "true" ]]; then
    args_base+=(--size "$SIZE")
  fi
  for image_path in "${INPUT_IMAGES[@]}"; do
    args_base+=(--input-image "$image_path")
  done

  for provider in "${providers[@]}"; do
    echo "auto: trying provider ${provider}" >&2
    if bash "$0" --provider "$provider" "${args_base[@]}"; then
      exit 0
    fi
    last_status=$?
    echo "auto: provider ${provider} failed with status ${last_status}, trying next provider" >&2
  done

  jq -n --arg provider "auto" \
    '{status: "error", provider: $provider, error: "all configured image providers failed", images: []}'
  exit "${last_status:-1}"
}

case "$PROVIDER" in
  auto|default)
    PROVIDER="auto"
    generate_auto
    ;;
  gpt-image2|gpt-image-2|image2|yunwu-gpt-image2)
    PROVIDER="gpt-image2"
    generate_gpt_image2
    ;;
  nano-banana|nanobanana|nano)
    PROVIDER="nano-banana"
    generate_nano_banana
    ;;
  siliconflow|siliconflow-qwen-image|qwen-image|qwen)
    PROVIDER="siliconflow-qwen-image"
    generate_siliconflow_qwen_image
    ;;
  openai|gpt-image|gpt-image-2|chatgpt-image)
    PROVIDER="openai"
    generate_openai
    ;;
  *)
    echo "Unsupported provider: $PROVIDER. Use auto, gpt-image2, nano-banana, siliconflow-qwen-image, or openai." >&2
    exit 1
    ;;
esac
