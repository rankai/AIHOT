# Changelog

## 0.4.0

- Simplified the skill into direct image generation plus Pro missing-information guidance.
- Direct mode sends the user's prompt or keywords directly to the model.
- Pro mode now checks whether basic prompt elements are complete, asks the user to fill missing information, and sends the user-approved completed prompt to the model.
- Removed active prompt rewriting, case-library selection, prompt option generation, and rule-based prompt optimization from the release workflow.
- Marked old prompt-case data, evals, and prompt-rule references as ignored for public release.

## 0.3.0

- Changed the default generation path to Direct Raw mode.
- Replaced brand restriction modes with brand passthrough.
- Added prompt workflow references and rule modules.

## 0.2.0

- Added simplified user-facing prompt option format.
- Added generation parameter confirmation rules.
- Added platform presets.
- Expanded prompt case library.
- Added recommendation and import scripts.

## 0.1.0

- Initial skill structure.
- Added Nano Banana-compatible provider.
- Added OpenAI GPT Image-compatible provider implementation.
