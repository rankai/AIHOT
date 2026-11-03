# Integration Contract

`ai-image-generator` is a reusable image generation component for other agent
skills.

## Core Contract

Calling skills should pass the user's prompt unchanged.

Do not rewrite, improve, expand, stylize, translate, filter, or add negative
prompt text unless the user explicitly asks for prompt writing.

The component may resolve image size and aspect-ratio parameters. Size
resolution is API parameter handling, not prompt rewriting.

## Standard Call

```bash
bash /path/to/ai-image-generator/scripts/generate-image.sh \
  --provider auto \
  --prompt "$USER_PROMPT" \
  --output-dir "$OUTPUT_DIR" \
  --output-prefix "$ASSET_ID"
```

Pass explicit size parameters only when the user or upstream workflow has
already specified them:

```bash
bash /path/to/ai-image-generator/scripts/generate-image.sh \
  --provider auto \
  --prompt "$USER_PROMPT" \
  --size 1024x1024 \
  --aspect-ratio 1:1 \
  --output-dir "$OUTPUT_DIR" \
  --output-prefix "$ASSET_ID"
```

Reference images can be repeated:

```bash
bash /path/to/ai-image-generator/scripts/generate-image.sh \
  --provider auto \
  --input-image /absolute/path/reference.png \
  --prompt "$USER_PROMPT" \
  --output-dir "$OUTPUT_DIR" \
  --output-prefix "$ASSET_ID"
```

## Size Resolution Priority

```text
explicit caller size/aspect ratio
> explicit size/aspect ratio in user prompt
> matched platform/use-case spec
> provider/script default
```

Use this command to inspect size resolution without calling an image API:

```bash
bash /path/to/ai-image-generator/scripts/resolve-image-spec.sh \
  --query "$USER_PROMPT"
```

Common matched specs include WeChat Official Account covers, WeChat body
illustrations, Xiaohongshu cards, Douyin covers, PPT covers, mobile wallpapers,
Bilibili covers, blog/social covers, e-commerce main images, and avatars.

The machine-readable spec table is `references/platform-image-specs.json`.

## Provider Contract

Global priority:

```text
agent-native image generation
> script/API auto
> user-pinned provider
```

Use the agent's native image generation capability first when the runtime
provides one and the user did not explicitly request a third-party API. The
bundled `scripts/generate-image.sh` cannot call agent-native tools by itself; it
only handles API providers.

Supported provider values:

```text
auto
gpt-image2
nano-banana
siliconflow-qwen-image
openai
```

Default script/API `auto` order:

```text
gpt-image2 -> nano-banana -> siliconflow-qwen-image -> openai
```

Each user must configure their own keys in one of these locations:

```text
~/.config/ai-image-generator/.env
~/.ai-image-generator/.env
./.env
```

Do not commit real `.env` files, API keys, provider keys, cookies, or private
URLs.

## Output JSON

Successful calls return JSON shaped like:

```json
{
  "status": "success",
  "provider": "gpt-image2",
  "images": ["/absolute/path/generated.png"],
  "raw_json": "/absolute/path/response.json",
  "image_spec": {
    "source": "matched_spec",
    "asset_type": "wechat_main_cover",
    "matched_keywords": ["微信公众号头图"],
    "size": "1800x766",
    "aspect_ratio": "2.35:1",
    "provider_aspect_ratio": "21:9"
  }
}
```

Failure calls return JSON with `status: "error"` when the response can be
parsed. Some missing dependency or missing configuration failures may exit with
a non-zero status and write the error to stderr.

Calling skills should treat `images[]` as the only generated image file contract
and should not guess output paths.

## Security Rules

- Never pass secrets in prompts.
- Never print `.env` contents in user-facing output.
- Never commit `.env`, raw responses containing secrets, generated images,
  local test data, or private reference images unless the user explicitly asks
  and the files are safe for public release.
- Use `.env.example` placeholders only.
