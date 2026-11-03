# Acceptance Checklist

## Completed

- Skill structure is complete for the simplified release: `SKILL.md`, `README.md`, `README.en.md`, `LICENSE`, scripts, references, and release checklist.
- The skill is now a reusable image generation component that other skills can call instead of re-implementing provider routing.
- Direct mode sends the user's prompt directly to the model.
- Pro mode is simplified to missing-information guidance only.
- Prompt rewriting, prompt option generation, case-library selection, and rule-based prompt optimization are not part of the active release workflow.
- Platform/use-case size resolution is supported through `references/platform-image-specs.json` and `scripts/resolve-image-spec.sh`.
- Size resolution follows the required priority: caller/user explicit size first, matched platform spec second, provider/script default last.
- The standard output JSON includes generated image paths, provider, raw response path, and `image_spec`.
- Nano Banana-compatible provider has passed real API generation tests.
- OpenAI GPT Image-compatible provider is implemented.
- GPT-image2 and SiliconFlow Qwen Image providers are implemented through configurable API variables.
- Release ignore rules exclude `.env`, local env variants, generated outputs, response JSON files, local workflow test results, old prompt-case data, evals, and old prompt-rule references while allowing the public platform size specs.

## Not Fully Verified

- OpenAI GPT Image-compatible provider is implemented but not real-API tested because no API key is available.
- GPT-image2 and SiliconFlow provider paths are implemented but should remain marked provider-config dependent until tested by each user with their own keys.
- Cross-agent installation testing is not done yet for Claude Code, Open Codex, and OpenClaw.

## Test Policy

OpenAI provider must remain marked as unverified until a real successful API call is completed with a valid key.

Public release must never include real API keys, real provider credentials,
private URLs, `.env`, generated output images, or raw API responses.
