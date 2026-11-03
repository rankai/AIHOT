#!/usr/bin/env bash
set -euo pipefail

QUERY=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/build-prompt-brief.sh --query "..."

Check whether a user image prompt has the basic elements needed for Pro guided generation.
This script does not optimize, rewrite, search examples, or generate prompt options.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --query)
      QUERY="${2:-}"
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

if [[ -z "$QUERY" ]]; then
  echo "Missing required --query." >&2
  usage >&2
  exit 1
fi

lower_query="$(printf '%s' "$QUERY" | tr '[:upper:]' '[:lower:]')"

contains_any() {
  local text="$1"
  shift
  local needle
  for needle in "$@"; do
    case "$text" in
      *"$needle"*) return 0 ;;
    esac
  done
  return 1
}

image_type="general-image"
aspect_ratio=""
provider_ratio_note=""
spec_source="not_checked"

if [[ -x "${SCRIPT_DIR}/resolve-image-spec.sh" ]]; then
  spec_json="$(bash "${SCRIPT_DIR}/resolve-image-spec.sh" --query "$QUERY")"
  spec_source="$(jq -r '.source // "not_found"' <<<"$spec_json")"
  resolved_asset_type="$(jq -r '.asset_type // empty' <<<"$spec_json")"
  resolved_ratio="$(jq -r '.aspect_ratio // empty' <<<"$spec_json")"
  resolved_provider_ratio="$(jq -r '.provider_aspect_ratio // empty' <<<"$spec_json")"
  resolved_note="$(jq -r '.notes // empty' <<<"$spec_json")"
  if [[ -n "$resolved_asset_type" ]]; then
    image_type="$resolved_asset_type"
  fi
  if [[ -n "$resolved_ratio" ]]; then
    aspect_ratio="$resolved_ratio"
  fi
  if [[ -n "$resolved_provider_ratio" && "$resolved_provider_ratio" != "$resolved_ratio" ]]; then
    provider_ratio_note="Provider ratio: ${resolved_provider_ratio}. ${resolved_note}"
  elif [[ -n "$resolved_note" ]]; then
    provider_ratio_note="$resolved_note"
  fi
fi

if [[ "$image_type" == "general-image" ]] && contains_any "$lower_query" "公众号" "微信头图" "wechat" "首图"; then
  image_type="wechat-cover"
  aspect_ratio="2.35:1"
  provider_ratio_note="Nano Banana uses 21:9 as the closest supported ratio."
elif [[ "$image_type" == "general-image" ]] && contains_any "$lower_query" "小红书" "xiaohongshu"; then
  image_type="xiaohongshu-cover"
  aspect_ratio="3:4"
elif [[ "$image_type" == "general-image" ]] && contains_any "$lower_query" "电商" "主图" "ecommerce" "商品"; then
  image_type="ecommerce-main-image"
  aspect_ratio="1:1"
elif [[ "$image_type" == "general-image" ]] && contains_any "$lower_query" "头像" "avatar" "profile"; then
  image_type="social-avatar"
  aspect_ratio="1:1"
elif [[ "$image_type" == "general-image" ]] && contains_any "$lower_query" "ppt" "课程封面" "presentation" "course cover"; then
  image_type="ppt-cover"
  aspect_ratio="16:9"
elif [[ "$image_type" == "general-image" ]] && contains_any "$lower_query" "手机壁纸" "wallpaper" "竖屏"; then
  image_type="mobile-wallpaper"
  aspect_ratio="9:16"
elif [[ "$image_type" == "general-image" ]] && contains_any "$lower_query" "海报" "poster" "flyer"; then
  image_type="poster-flyer"
  aspect_ratio="3:4"
fi

has_subject="false"
if [[ ${#QUERY} -ge 4 ]]; then
  has_subject="true"
fi

has_purpose="false"
if contains_any "$lower_query" "用于" "用来" "适合" "发布" "宣传" "封面" "海报" "主图" "头像" "壁纸" "poster" "cover" "ad" "ecommerce"; then
  has_purpose="true"
fi

has_output_type="false"
if [[ "$image_type" != "general-image" ]] || contains_any "$lower_query" "图片" "image" "illustration" "photo" "render"; then
  has_output_type="true"
fi

has_ratio="false"
if [[ -n "$aspect_ratio" ]] || contains_any "$lower_query" "1:1" "3:4" "4:5" "9:16" "16:9" "21:9" "2.35:1" "1024x1024" "1024×1024" "竖版" "横版" "方图"; then
  has_ratio="true"
fi

has_style="false"
if contains_any "$lower_query" "风格" "高级" "简洁" "极简" "写实" "摄影" "卡通" "插画" "科技" "清新" "复古" "可爱" "style" "mood" "realistic" "cartoon"; then
  has_style="true"
fi

has_text_decision="false"
if contains_any "$lower_query" "文字" "标题" "文案" "不要文字" "无文字" "no text" "text" "headline" "slogan"; then
  has_text_decision="true"
fi

has_reference_decision="false"
if contains_any "$lower_query" "参考图" "照片" "上传" "原图" "reference" "input image"; then
  has_reference_decision="true"
fi

missing=()
questions=()

if [[ "$has_subject" != "true" ]]; then
  missing+=("subject")
  questions+=("图片主体是什么？")
fi

if [[ "$has_output_type" != "true" ]]; then
  missing+=("output_type")
  questions+=("你希望生成什么类型的图片？例如海报、封面、产品图、头像、插画或壁纸。")
fi

if [[ "$has_ratio" != "true" ]]; then
  missing+=("aspect_ratio_or_size")
  if [[ -n "$aspect_ratio" ]]; then
    questions+=("图片比例是否按 ${aspect_ratio}？如果不是，请指定比例或尺寸。")
  else
    questions+=("图片比例或尺寸要用什么？例如 1:1、3:4、16:9、9:16。")
  fi
fi

if [[ "$has_text_decision" != "true" && ( "$image_type" == "poster-flyer" || "$image_type" == "wechat-cover" || "$image_type" == "xiaohongshu-cover" || "$image_type" == "ppt-cover" ) ]]; then
  missing+=("visible_text")
  questions+=("图片里是否需要出现文字？如果需要，请给出准确文字；如果不需要，请确认无文字。")
fi

if [[ "$has_style" != "true" ]]; then
  missing+=("style_or_mood")
  questions+=("你希望画面是什么风格或氛围？如果没有偏好，可以直接说交给模型。")
fi

missing_json="[]"
questions_json="[]"
if [[ ${#missing[@]} -gt 0 ]]; then
  missing_json="$(printf '%s\n' "${missing[@]}" | jq -R . | jq -s .)"
  questions_json="$(printf '%s\n' "${questions[@]}" | jq -R . | jq -s .)"
fi

jq -n \
  --arg user_prompt "$QUERY" \
  --arg image_type "$image_type" \
  --arg aspect_ratio "$aspect_ratio" \
  --arg provider_ratio_note "$provider_ratio_note" \
  --arg spec_source "$spec_source" \
  --arg has_subject "$has_subject" \
  --arg has_purpose "$has_purpose" \
  --arg has_output_type "$has_output_type" \
  --arg has_ratio "$has_ratio" \
  --arg has_style "$has_style" \
  --arg has_text_decision "$has_text_decision" \
  --arg has_reference_decision "$has_reference_decision" \
  --argjson missing "$missing_json" \
  --argjson questions "$questions_json" '
{
  user_prompt: $user_prompt,
  mode_policy: {
    direct: "Send the user prompt directly to the model.",
    pro: "Check basic prompt elements, ask only for missing material information, then send the user-approved completed prompt to the model."
  },
  inferred: {
    image_type: $image_type,
    image_spec_source: $spec_source,
    default_aspect_ratio: (if $aspect_ratio == "" then null else $aspect_ratio end),
    provider_ratio_note: (if $provider_ratio_note == "" then null else $provider_ratio_note end)
  },
  detected_elements: {
    subject: ($has_subject == "true"),
    purpose: ($has_purpose == "true"),
    output_type: ($has_output_type == "true"),
    aspect_ratio_or_size: ($has_ratio == "true"),
    style_or_mood: ($has_style == "true"),
    visible_text_decision: ($has_text_decision == "true"),
    reference_image_decision: ($has_reference_decision == "true")
  },
  missing_elements: $missing,
  questions_to_ask: $questions,
  direct_prompt_instruction: "Use the raw user prompt only.",
  pro_completion_instruction: "Ask the questions_to_ask if any. After the user answers, combine the original prompt and the user answers without creative rewriting, then send the completed prompt to the model."
}'
