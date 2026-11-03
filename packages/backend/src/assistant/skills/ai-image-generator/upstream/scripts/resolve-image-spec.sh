#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SPECS_PATH="${SKILL_DIR}/references/platform-image-specs.json"

QUERY=""
USER_SIZE=""
USER_ASPECT_RATIO=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/resolve-image-spec.sh --query "..." [--size 1024x1024] [--aspect-ratio 16:9]

Resolve image size/aspect-ratio parameters without rewriting the prompt.

Priority:
  1. Explicit --size or --aspect-ratio from the caller.
  2. Explicit size or aspect ratio found in the user query.
  3. Keyword match in references/platform-image-specs.json.
  4. No match; return null values.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --query)
      QUERY="${2:-}"
      shift 2
      ;;
    --size)
      USER_SIZE="${2:-}"
      shift 2
      ;;
    --aspect-ratio)
      USER_ASPECT_RATIO="${2:-}"
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

if ! command -v jq >/dev/null 2>&1; then
  echo "Missing dependency: jq." >&2
  exit 1
fi

if [[ ! -f "$SPECS_PATH" ]]; then
  echo "Missing platform specs: $SPECS_PATH" >&2
  exit 1
fi

normalize_ratio() {
  local ratio="$1"
  ratio="${ratio//：/:}"
  ratio="${ratio// /}"
  printf '%s' "$ratio"
}

if [[ -n "$USER_SIZE" || -n "$USER_ASPECT_RATIO" ]]; then
  jq -n \
    --arg source "user_explicit_cli" \
    --arg size "$USER_SIZE" \
    --arg aspect_ratio "$(normalize_ratio "$USER_ASPECT_RATIO")" \
    '{
      source: $source,
      asset_type: null,
      matched_keywords: [],
      size: (if $size == "" then null else $size end),
      aspect_ratio: (if $aspect_ratio == "" then null else $aspect_ratio end),
      provider_aspect_ratio: (if $aspect_ratio == "" then null else $aspect_ratio end),
      notes: "Caller explicitly provided size or aspect ratio."
    }'
  exit 0
fi

prompt_size="$(printf '%s' "$QUERY" | perl -CS -ne 'if (/([0-9]{3,5})\s*[xX×]\s*([0-9]{3,5})/) { print "$1x$2"; exit }')"
prompt_ratio="$(printf '%s' "$QUERY" | perl -CS -ne 'if (/([0-9]+(?:\.[0-9]+)?)\s*[:：]\s*([0-9]+(?:\.[0-9]+)?)/) { print "$1:$2"; exit } elsif (/(\b(?:1:1|3:4|4:5|9:16|16:9|21:9)\b)/) { print "$1"; exit }')"

if [[ -n "$prompt_size" || -n "$prompt_ratio" ]]; then
  jq -n \
    --arg source "user_explicit_prompt" \
    --arg size "$prompt_size" \
    --arg aspect_ratio "$(normalize_ratio "$prompt_ratio")" \
    '{
      source: $source,
      asset_type: null,
      matched_keywords: [],
      size: (if $size == "" then null else $size end),
      aspect_ratio: (if $aspect_ratio == "" then null else $aspect_ratio end),
      provider_aspect_ratio: (if $aspect_ratio == "" then null else $aspect_ratio end),
      notes: "The user prompt explicitly contains a size or aspect ratio."
    }'
  exit 0
fi

jq -n \
  --arg query "$QUERY" \
  --slurpfile specs "$SPECS_PATH" '
  def matched_keywords($entry):
    [($entry.keywords // [])[] as $kw | if (($query | ascii_downcase) | contains($kw | ascii_downcase)) then $kw else empty end];

  ($specs[0] | map(. + {matched_keywords: matched_keywords(.)}) | map(select((.matched_keywords | length) > 0)) | first) as $match
  | if $match == null then
      {
        source: "not_found",
        asset_type: null,
        matched_keywords: [],
        size: null,
        aspect_ratio: null,
        provider_aspect_ratio: null,
        notes: "No explicit size and no matching platform spec."
      }
    else
      {
        source: "matched_spec",
        asset_type: $match.asset_type,
        matched_keywords: $match.matched_keywords,
        size: $match.size,
        aspect_ratio: $match.aspect_ratio,
        provider_aspect_ratio: ($match.provider_aspect_ratio // $match.aspect_ratio),
        alternate_size: ($match.alternate_size // null),
        notes: ($match.notes // null)
      }
    end'
