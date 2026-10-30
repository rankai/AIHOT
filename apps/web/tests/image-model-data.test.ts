import assert from "node:assert/strict";
import { test } from "node:test";
import { imageGenerationBody, imageGenerationModels, imageModelDraft, imageParameterRows, imageProviderStatuses, imageQueryBody, imageReferenceReuseId, imageSavedTaskFacts, imageSizeIssue, imageTaskModel, imageUploadReferenceLink, selectedImageUploads } from "../app/features/admin/image-model-data.ts";
import type { ImageModel, ImageModelOption, ImageOptions, PrivateAsset } from "../app/features/admin/image-types.ts";
const options: ImageOptions = {
  modelLabel: "Redfox GPT-Image-2", resolutions: ["1k", "2k", "4k"], sizes: ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21"], maxImages: 4, maxReferences: 2,
  referenceBytes: 10_000_000, referencePixels: 16_000_000, outputBytes: 64 * 1024 * 1024, outputPixels: 64_000_000, pollLimit: 60, pollDeadlineSeconds: 7200, uploadTransportVerified: false,
  services: { referenceUpload: "redfox.media", submission: "redfox.image", poll: "redfox.poll" }, submissionCost: null,
  models: [
    { model: "gptImage2", label: "Redfox GPT-Image-2", maxReferences: 2, maxImages: 4 },
    { model: "gptImage25", label: "Redfox GPT-Image-2.5", resolutions: ["1k", "2k", "4k"], sizes: ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9"], background: ["transparent"], maxReferences: 4, maxOutputImages: 10, documentedBaseCny: 1.5 },
    { model: "geminiBanana21", label: "Redfox Gemini Banana 2.1", resolutions: ["1K", "2K", "4K"], sizes: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "5:4", "4:5", "21:9", "1:4", "4:1", "1:8", "8:1"], maxReferences: 4, maxOutputImages: 10, documentedBaseCny: 1 },
    { model: "seedreamPro", label: "Redfox Seedream Pro", sizes: ["1K", "2K"], customSize: true, customPixelMaximum: 64_000_000, ratioRange: [1 / 16, 16], maxReferences: 4, maxOutputImages: 10, documentedBaseCny: 1, outputFormats: ["png", "jpeg"], optimizePromptModes: ["standard", "fast"], watermark: true, responseFormat: "url" },
    { model: "seedreamLite", generationAvailable: false, label: "Redfox Seedream Lite", sizes: ["2K", "3K", "4K"], customSize: true, customPixelMinimum: 3_686_400, customPixelMaximum: 16_777_216, ratioRange: [1 / 16, 16], maxReferences: 4, maxImages: 10, documentedBaseCny: 0.71, outputFormats: ["png", "jpeg"], optimizePromptModes: ["standard", "fast"], watermark: true, responseFormat: "url", sequentialModes: ["auto", "disabled"], maxImagesRange: [1, 10] },
  ],
  newModelLimits: { steps: 80, polls: 60, pollDeadlineSeconds: 7200, saveAttempts: 30 }, priceBasis: "documented-estimate", billingUnitVerified: false, referenceReuseHint: "Explicit reuse",
};
const option = (model: ImageModel): ImageModelOption => options.models.find(row => row.model === model)!;
const draft = (model: ImageModel) => ({ ...imageModelDraft(option(model), options), prompt: " \n画面 👩‍💻\n " });
const asset: PrivateAsset = { key: "uploads/redfox/ref", content_type: "image/png", bytes: 100, purpose: "operation-input", status: "available", metadata: { filename: "ref.png", width: 4000, height: 4000 } };

test("old GPT2 body stays compatible with all thirteen ratios and n; new models never leak old fields", () => {
  const old = { ...draft("gptImage2"), resolution: "4k", size: "9:21", n: 4, selected: [asset] };
  assert.deepEqual(imageGenerationBody("gptImage2", old, options), { prompt: "画面 👩‍💻", resolution: "4k", size: "9:21", n: 4, fileKeys: [asset.key] });
  for (const model of ["gptImage25", "geminiBanana21", "seedreamPro"] as const) {
    const body = imageGenerationBody(model, { ...draft(model), n: 4 }, options);
    assert.equal(Object.hasOwn(body, "n"), false); assert.equal(body.prompt, draft(model).prompt); assert.equal(body.model, model);
  }
});
test("GPT25 has exact lowercase resolution/ratio fields and only an explicitly selected transparent background", () => {
  assert.deepEqual(imageGenerationBody("gptImage25", draft("gptImage25"), options), { model: "gptImage25", prompt: draft("gptImage25").prompt, size: "1:1", fileKeys: [], resolution: "1k" });
  assert.equal(imageGenerationBody("gptImage25", { ...draft("gptImage25"), transparent: true }, options).background, "transparent");
  assert.throws(() => imageGenerationBody("gptImage25", { ...draft("gptImage25"), resolution: "1K" }, options));
  assert.throws(() => imageGenerationBody("gptImage25", { ...draft("gptImage25"), size: "9:21" }, options));
});
test("Gemini sends uppercase metadata resolution and fourteen-ratio choices without top resolution or background", () => {
  const body = imageGenerationBody("geminiBanana21", { ...draft("geminiBanana21"), resolution: "4K", size: "8:1", transparent: true }, options);
  assert.deepEqual(body, { model: "geminiBanana21", prompt: draft("geminiBanana21").prompt, size: "8:1", fileKeys: [], metadata: { resolution: "4K" } });
  assert.throws(() => imageGenerationBody("geminiBanana21", { ...draft("geminiBanana21"), resolution: "4k" }, options));
});
test("Seedream requests only URL-saveable outputs with actual false watermark and structured optimization", () => {
  const pro = imageGenerationBody("seedreamPro", { ...draft("seedreamPro"), outputFormat: "jpeg", optimizeMode: "fast", watermark: false }, options);
  assert.deepEqual(pro, { model: "seedreamPro", prompt: draft("seedreamPro").prompt, size: "1K", fileKeys: [], outputFormat: "jpeg", watermark: false, optimizePromptOptions: { mode: "fast" }, responseFormat: "url" });
  assert(!Object.hasOwn(pro, "sequentialImageGeneration")); assert(!Object.hasOwn(pro, "resolution"));
  assert.throws(() => imageGenerationBody("seedreamPro", { ...draft("seedreamPro"), outputFormat: "b64_json" }, options));
  assert.throws(() => imageGenerationBody("seedreamPro", { ...draft("seedreamPro"), optimizeMode: "invented" }, options));
});
test("custom sizes enforce explicit positive integer ratio/pixel caps without inventing a Pro minimum", () => {
  for (const size of ["1x1", "1x16", "16x1", "8000x8000", "1K", "2K"]) assert.equal(imageSizeIssue(size, option("seedreamPro")), null);
  for (const size of ["0x1", "01x1", "1X1", "1.5x2", "17x1", "8001x8000", "9007199254740993x1"]) assert(imageSizeIssue(size, option("seedreamPro")));
  for (const size of ["1920x1920", "4096x4096", "480x7680", "7680x480", "2K", "3K", "4K"]) assert.equal(imageSizeIssue(size, option("seedreamLite")), null);
  for (const size of ["1919x1920", "4097x4096", "8192x480", "1K"]) assert(imageSizeIssue(size, option("seedreamLite")));
  assert.equal(imageGenerationBody("seedreamPro", { ...draft("seedreamPro"), size: "custom", customSize: "1x1" }, options).size, "1x1");
});
test("retired Lite drafts require reselection while old task queries retain the model", () => {
  assert.equal(imageGenerationModels(options).some(row => row.model === "seedreamLite"), false);
  assert.throws(() => imageGenerationBody("seedreamLite", draft("seedreamLite"), options), /暂不开放新生成/);
  assert.deepEqual(imageQueryBody("seedreamLite", "old-task", options), { model: "seedreamLite", taskId: "old-task" });
  assert.equal(imageTaskModel({model:"seedreamLite"}, options)?.model, "seedreamLite");
});
test("four-reference models preserve actual selection, explicit reuse excludes removed files, GPT2 cannot inherit it", () => {
  const selected = Array.from({ length: 4 }, (_, i) => ({ ...asset, key: `${asset.key}/${i}` }));
  const reuse = [{ fileKey: selected[0]!.key, resultId: 91 }, { fileKey: "removed", resultId: 92 }];
  const body = imageGenerationBody("gptImage25", { ...draft("gptImage25"), selected, referenceUploads: reuse }, options);
  assert.deepEqual(body.fileKeys, selected.map(row => row.key)); assert.deepEqual(body.referenceUploads, [reuse[0]]);
  assert.equal(Object.hasOwn(imageGenerationBody("gptImage25", { ...draft("gptImage25"), selected: [], referenceUploads: reuse }, options), "referenceUploads"), false);
  assert.throws(() => selectedImageUploads("gptImage2", [asset], reuse));
  assert.throws(() => imageGenerationBody("gptImage2", { ...draft("gptImage2"), selected }, options));
  assert.throws(() => imageGenerationBody("gptImage25", { ...draft("gptImage25"), selected: [asset, { ...asset }] }, options));
  assert.throws(() => imageGenerationBody("gptImage25", { ...draft("gptImage25"), selected: [{ ...asset, status: "deleted" }] }, options));
  const first = imageModelDraft(option("gptImage2"), options), second = imageModelDraft(option("gptImage25"), options);
  first.selected.push(asset); assert.deepEqual(second.selected, []); assert.deepEqual(second.referenceUploads, []);
});
test("new prompts and model-specific task IDs retain whitespace; blanks and length boundaries are enforced", () => {
  for (const model of options.models.map(row => row.model)) {
    const body = imageQueryBody(model, " task-90071992547409931234 \n", options);
    assert.equal(body.taskId, " task-90071992547409931234 \n");
    assert.equal(Object.hasOwn(body, "model"), model !== "gptImage2");
    assert.throws(() => imageQueryBody(model, " \n", options)); assert.throws(() => imageQueryBody(model, "x".repeat(501), options));
  }
  assert.equal(imageQueryBody("gptImage25", "x".repeat(500), options).taskId.length, 500);
  assert.throws(() => imageGenerationBody("gptImage25", { ...draft("gptImage25"), prompt: " \n" }, options));
  assert.throws(() => imageGenerationBody("gptImage25", { ...draft("gptImage25"), prompt: "x".repeat(10001) }, options));
});
test("reuse links require this stored upload result and genuinely usable local reference metadata", () => {
  const result = { id: 91, kind: "media_upload", data: { operationId: "6L178PZD" }, fileKey: asset.key, file: { key: asset.key, filename: "ref.png", contentType: "image/png", bytes: 100, status: "available", width: 4000, height: 4000 } };
  const link = imageUploadReferenceLink(result, options); assert(link);
  const query = new URL(link, "https://local.test").searchParams;
  assert.equal(query.get("imageModel"), "gptImage25"); assert.equal(query.get("reference"), asset.key); assert.equal(query.get("referenceUploadResult"), "91");
  for (const patch of [{ status: "deleted" }, { contentType: "audio/x-m4a" }, { width: null }, { width: 4001 }, { bytes: 10_000_001 }]) assert.equal(imageUploadReferenceLink({ ...result, file: { ...result.file, ...patch } }, options), null);
  assert.equal(imageUploadReferenceLink({ ...result, fileKey: "different" }, options), null);
  for (const raw of ["", "0", "-1", "1.5", "9007199254740993"]) assert.equal(imageReferenceReuseId(raw), null);
  assert.equal(imageReferenceReuseId("91"), 91);
});
test("completed task facts retain model and raw ID after progress clears; response metadata and usage stay separate", () => {
  const operation = { progress: {}, inputs: { parameters: { model: "geminiBanana21", prompt: " raw ", metadata: { resolution: "4K" }, size: "8:1" } }, results: [{ kind: "image_task", data: { taskId: " task ", status: "completed", metadata: { resolution: "4K" }, usage: { progress: 99 } } }] };
  assert.equal(imageSavedTaskFacts(operation).taskId, " task "); assert.equal(imageTaskModel(operation.inputs.parameters, options)?.model, "geminiBanana21");
  assert.equal(imageTaskModel({}, options)?.model, "gptImage2");
  assert(imageParameterRows(operation.inputs.parameters).some(([label, value]) => label === "分辨率" && value === "4K"));
  assert(!imageSavedTaskFacts(operation).rows.some(([label]) => /进度|usage/.test(label)));
  assert.equal(imageProviderStatuses.running, "生成中"); assert.equal(imageProviderStatuses.succeeded, "生成完成");
  assert(imageParameterRows({ watermark: false, sequentialImageGenerationOptions: { maxImages: 10 } }).some(([, value]) => /false/.test(value)));
});
