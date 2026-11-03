# Usage Examples

## Direct Generation

User request:

```text
香奈儿七夕香水礼盒海报，保留品牌logo，高级法式风格
```

Behavior:

```text
Send the user prompt directly to the selected image model.
```

Example command:

```bash
bash scripts/generate-image.sh \
  --provider nano-banana \
  --prompt "香奈儿七夕香水礼盒海报，保留品牌logo，高级法式风格" \
  --aspect-ratio 3:4 \
  --output-dir ./outputs
```

## Pro Missing-Information Check

User request:

```text
给夏季咖啡活动做一张海报
```

Example command:

```bash
bash scripts/build-prompt-brief.sh \
  --query "给夏季咖啡活动做一张海报"
```

Expected behavior:

```text
Return missing elements such as aspect ratio, visible text decision, and style or mood.
Ask concise questions before generation.
After the user answers, combine the original prompt and user-provided answers without creative rewriting.
```

## Image-To-Image

User request:

```text
用这张产品图做一张干净的电商主图。
```

Example command:

```bash
bash scripts/generate-image.sh \
  --provider nano-banana \
  --input-image ./reference.png \
  --prompt "用这张产品图做一张干净的电商主图" \
  --aspect-ratio 1:1 \
  --output-dir ./outputs
```
