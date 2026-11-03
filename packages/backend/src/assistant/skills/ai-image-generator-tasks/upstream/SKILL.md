---
name: ai-image-generator
description: Use this skill whenever the user wants to generate, create, edit, or restyle an AI image through the agent's native image generation capability or configured image APIs such as GPT-image2, Nano Banana-compatible APIs, SiliconFlow Qwen Image, or OpenAI GPT Image-compatible APIs. Direct mode sends the user's prompt directly to the model. Pro mode only checks whether the user's prompt has the basic elements needed for generation, asks for missing information, then sends the completed user-approved prompt to the model.
version: 0.4.2
---

# AI Image Generator

Use this skill as a general-purpose image generation component. Other skills
can call it whenever they need image generation instead of re-implementing image
provider routing, API calls, output parsing, or common platform size defaults.

## Provider Priority

Use this global priority:

1. Agent-native image generation, when the current agent/runtime provides a
   built-in image generation tool and the user did not explicitly request a
   third-party API.
2. Script/API `--provider auto`, whose fallback order is `gpt-image2`,
   `nano-banana`, `siliconflow-qwen-image`, then `openai`.
3. A specific provider pinned by the user or calling skill.

The bundled `scripts/generate-image.sh` cannot call agent-native tools by
itself. It only handles configured API providers. Agent-native generation is an
instruction for the agent using this skill.

There are only two modes:

1. **Direct mode**: send the user's prompt or keywords directly to the selected image model.
2. **Pro mode**: check whether the user's prompt has enough basic generation information. If something important is missing, ask the user to fill it in. After the user confirms the missing information, send the completed prompt to the model.

Do not rewrite, optimize, stylize, expand, or re-rank the user's prompt unless the user explicitly asks you to write final copy. Do not use a case library or prompt examples to transform the user's intent.

This skill may infer image size or aspect-ratio API parameters from the user's
stated use case. Size inference is not prompt rewriting.

## Direct Mode

Use Direct mode by default.

The final prompt is the user's original input:

```text
[user prompt or keywords]
```

Do not add output form, style, composition, quality, text, brand, safety, or negative prompt constraints in Direct mode. Provider parameters such as aspect ratio, image size, number of images, or input image path may still be passed as API parameters.

## Size Resolution

Use this priority for image size and aspect ratio:

1. If the user or calling skill explicitly provides `--size` or
   `--aspect-ratio`, use that value.
2. If no explicit size is provided, inspect the raw user prompt for an explicit
   size or ratio such as `1024x1024`, `16:9`, `9:16`, or `2.35:1`.
3. If the prompt has no explicit size, match platform/use-case keywords against
   `references/platform-image-specs.json`.
4. If nothing matches, do not invent a size. Let the provider or script default
   apply.

The size resolver must not change the prompt text.

Check size resolution without generating an image:

```bash
bash scripts/resolve-image-spec.sh --query "生成一张微信公众号头图，主题是 AI 生图模型配置"
```

## Pro Mode

Use Pro mode only when the user asks for:

- Pro mode
- prompt checking
- help completing a prompt
- guidance before generation
- "帮我看看提示词是否完整"
- "缺什么你问我"
- "先帮我确认信息再生成"

Pro mode is not prompt optimization. It is a missing-information guide.

### Basic Elements To Check

Check whether the user's prompt contains enough information for generation:

- `subject`: what should appear in the image.
- `purpose`: what the image will be used for, if relevant.
- `output_type`: poster, cover, product photo, avatar, illustration, wallpaper, etc.
- `aspect_ratio_or_size`: ratio or size, if the target platform matters.
- `style_or_mood`: visual style, mood, realism level, or brand mood, if the user cares.
- `visible_text`: exact text to appear, or "no text", if the image may include text.
- `reference_image`: whether an input image should be used, and what must be preserved.
- `provider`: only when the user cares or multiple configured providers are available.

Only ask for missing items that materially affect generation. If the user clearly does not care, do not ask.

### Pro Interaction

When information is missing, ask concise questions before generation:

```text
我先补齐几个会影响生成结果的信息：
1. 图片比例/尺寸要用什么？如果你不指定，我按 [default]。
2. 图片里是否需要出现文字？如果需要，请给 exact text。
3. 是否有参考图，或者需要保持某个主体不变？
```

After the user answers, create a completed prompt that combines:

- the user's original wording,
- the user's answers to missing questions,
- no extra creative rewriting.

Then generate the image.

## Helper Script

Use this helper to inspect missing prompt elements:

```bash
bash scripts/build-prompt-brief.sh --query "<user prompt>"
```

The helper returns:

- inferred image type,
- likely aspect ratio,
- detected prompt elements,
- missing elements,
- questions to ask,
- Direct prompt instruction,
- Pro completion instruction.

## Image Generation

Generate through Nano Banana-compatible providers:

```bash
bash scripts/generate-image.sh \
  --provider auto \
  --prompt "<user or completed prompt>" \
  --aspect-ratio 1:1 \
  --output-dir ./outputs
```

For other skills, the standard component call is:

```bash
bash /absolute/path/to/ai-image-generator/scripts/generate-image.sh \
  --provider auto \
  --prompt "<raw user prompt>" \
  --output-dir "<run output images dir>" \
  --output-prefix "<asset id>"
```

Only pass `--size` or `--aspect-ratio` when the caller already has an explicit
user requirement. Otherwise let `ai-image-generator` resolve known platform
defaults.

Provider choices:

- Agent-native image generation: default at the agent level when available.
- `auto`: script/API default. Try `gpt-image2`, `nano-banana`, `siliconflow-qwen-image`, then `openai`.
- `gpt-image2`: OpenAI-compatible GPT-image2 proxy, for example Yunwu.
- `nano-banana`: Nano Banana-compatible API.
- `siliconflow-qwen-image`: SiliconFlow `Qwen/Qwen-Image`.
- `openai`: generic OpenAI GPT Image-compatible API.

Generate through a specific provider:

```bash
bash scripts/generate-image.sh \
  --provider gpt-image2 \
  --prompt "<user or completed prompt>" \
  --size 1024x1024 \
  --output-dir ./outputs
```

For image-to-image, pass reference images:

```bash
bash scripts/generate-image.sh \
  --provider nano-banana \
  --input-image /absolute/path/reference.png \
  --prompt "<edit instruction>" \
  --aspect-ratio 1:1 \
  --output-dir ./outputs
```

## Configuration

Each user configures their own API keys and URLs in `.env`, `~/.ai-image-generator/.env`, or `~/.config/ai-image-generator/.env`.

Default script/API provider order:

```bash
IMAGE_PROVIDER=auto
```

At the agent level, use the agent's built-in image generation capability first
when available. Use `IMAGE_PROVIDER=auto` only when calling the bundled API
script or when the user explicitly asks for API/provider generation.

GPT-image2 through an OpenAI-compatible proxy such as Yunwu:

```bash
GPT_IMAGE2_BASE_URL="https://yunwu.ai"
GPT_IMAGE2_MODEL="gpt-image-2-all"
GPT_IMAGE2_API_KEY="your_api_key_here"
```

Nano Banana-compatible provider:

```bash
NANO_BANANA_API_URL="https://your-provider.example/v1beta/models/your-model:generateContent"
NANO_BANANA_API_KEY="your_api_key_here"
```

Yunwu Nano Banana-compatible aliases:

```bash
YUNWU_NANO_BANANA_BASE_URL="https://yunwu.ai"
YUNWU_NANO_BANANA_MODEL="gemini-3.1-flash-image-preview"
YUNWU_NANO_BANANA_API_KEY="your_api_key_here"
```

SiliconFlow Qwen Image:

```bash
SILICONFLOW_BASE_URL="https://api.siliconflow.cn/v1/images/generations"
SILICONFLOW_MODEL="Qwen/Qwen-Image"
SILICONFLOW_API_KEY="your_api_key_here"
```

OpenAI GPT Image-compatible provider:

```bash
OPENAI_IMAGE_API_KEY="your_openai_or_proxy_key_here"
OPENAI_IMAGE_MODEL="gpt-image-1.5"
OPENAI_IMAGE_GENERATE_URL="https://api.openai.com/v1/images/generations"
OPENAI_IMAGE_EDIT_URL="https://api.openai.com/v1/images/edits"
```

Validate configuration:

```bash
bash scripts/check-config.sh
```

## Output Handling

After generation, return:

- generated image path(s),
- provider used,
- aspect ratio or size,
- `image_spec.source`, showing whether the size came from `user_explicit_cli`,
  `user_explicit_prompt`, `matched_spec`, `not_found`, or `provider_default`,
- prompt sent to the model,
- raw JSON path for debugging.

If the environment supports local image rendering, show the image:

```markdown
![generated image](/absolute/path/output.png)
```

## Troubleshooting

- Missing API key: run `bash scripts/check-config.sh`.
- Missing `jq`: install it first, for example `brew install jq`.
- Provider returns no image: inspect the saved raw JSON response.
- OpenAI model mismatch: set `OPENAI_IMAGE_MODEL` to the model supported by the user's account or proxy.
