# Release Checklist

Use this checklist before publishing the skill to GitHub.

## Required

- Confirm `.env` is not committed.
- Confirm `.env.example` uses placeholders only.
- Confirm generated files under `outputs/` are not committed.
- Confirm local workflow artifacts such as `WORKFLOW_TEST_RESULTS.md` are not committed.
- Confirm old prompt-case data, evals, and old prompt-rule references are not committed.
- Confirm `references/platform-image-specs.md`, `references/platform-image-specs.json`, and `references/integration-contract.md` are included.
- Run script syntax checks:

```bash
bash -n scripts/build-prompt-brief.sh
bash -n scripts/resolve-image-spec.sh
bash -n scripts/generate-image.sh
bash -n scripts/check-config.sh
```

- Validate the platform specs:

```bash
jq empty references/platform-image-specs.json
```

- Run size-resolution checks:

```bash
bash scripts/resolve-image-spec.sh --query "生成一张微信公众号头图，主题是 AI 生图模型配置"
bash scripts/resolve-image-spec.sh --query "生成一张 1024x1024 的头像"
bash scripts/resolve-image-spec.sh --query "帮我做一个不知道用途的漂亮图"
```

- Run config check:

```bash
bash scripts/check-config.sh
```

- Review `README.md`, `README.en.md`, `SKILL.md`, `.env.example`, and `references/integration-contract.md`.
- Run a sensitive-data scan over all tracked and publish-candidate files.

## Recommended

- Keep the repository `LICENSE` file before public release.
- Verify install behavior in Claude Code, Open Codex, and OpenClaw.
- Keep OpenAI GPT Image provider marked as unverified until a real API call succeeds with a valid key.
- Keep GPT-image2 and SiliconFlow provider paths marked provider-config dependent until tested with the user's own keys.
