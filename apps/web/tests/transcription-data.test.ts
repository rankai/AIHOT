import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareAdminBody } from "../app/features/admin/action-body.ts";
import { isTranscriptionOperation, isTranscriptionPlatform, isTranscriptionResult, transcriptionCommand, transcriptionPlatforms, transcriptionProviderStatus, transcriptionRunStage, transcriptionSegmentPage, transcriptionSourceLink, transcriptionTaskFacts, transcriptionTextField, transcriptionTextPresentation } from "../app/features/admin/transcription-data.ts";

const huge = "000900719925474099312345", taskId = `  task/+==|${huge}  `;
const source = "  完整分享文案 😀\n请查看 https://example.com/video?token=a%2Fb\n保留尾部空格  ";
const saved = (id: number, kind: string, data: Record<string, unknown>) => ({ id, kind, data });

test("ASR ownership matches six platforms and two result kinds without consuming account/work/query/image results", () => {
  assert.deepEqual(Object.keys(transcriptionPlatforms), ["douyin", "xiaohongshu", "shipinhao", "kuaishou", "bilibili", "videoUrl"]);
  for (const platform of Object.keys(transcriptionPlatforms)) {
    assert.equal(isTranscriptionPlatform(platform), true);
    for (const kind of ["transcription", "transcription_task"]) assert.equal(isTranscriptionResult(kind, { platform }), true);
    for (const kind of ["query_summary", "article", "image", "image_task", `${platform}_work`, `${platform}_account`]) assert.equal(isTranscriptionResult(kind, { platform }), false);
  }
  for (const platform of ["youtube", "instagram", "tiktok", "unknown", null, 1]) assert.equal(isTranscriptionPlatform(platform), false);
  assert.equal(isTranscriptionResult("transcription", { platform: "unknown" }), false);
  assert.equal(isTranscriptionOperation("redfox.transcript.submit"), true);
  assert.equal(isTranscriptionOperation("redfox.transcript.query"), true);
  assert.equal(isTranscriptionOperation("redfox.sync.query"), false);
});

test("new transcription submits only platform and complete original sharing input without trimming or extracting its URL", () => {
  const command = transcriptionCommand("submit", "douyin", source);
  assert.deepEqual(command, { path: "/api/admin/redfox/transcriptions", body: { platform: "douyin", url: source } });
  const wire = JSON.parse(String(prepareAdminBody(command.body).body));
  assert.equal(wire.url, source);
  assert.deepEqual(Object.keys(wire).sort(), ["platform", "url"]);
  assert.equal(transcriptionCommand("submit", "videoUrl", "https://cdn.example/video.mp4").body.url, "https://cdn.example/video.mp4");
});

test("existing task queries preserve raw task ID and cannot accidentally call the submission endpoint", () => {
  const command = transcriptionCommand("query", "xiaohongshu", taskId);
  assert.deepEqual(command, { path: "/api/admin/redfox/transcriptions/query", body: { platform: "xiaohongshu", taskId } });
  const wire = JSON.parse(String(prepareAdminBody(command.body).body));
  assert.equal(wire.taskId, taskId);
  assert.deepEqual(Object.keys(wire).sort(), ["platform", "taskId"]);
});

test("input validity rejects blanks, unknown platforms and actual length limits without editing valid originals", () => {
  for (const value of ["", " ", "\n\t"]) for (const mode of ["submit", "query"] as const) assert.throws(() => transcriptionCommand(mode, "douyin", value));
  assert.throws(() => transcriptionCommand("submit", "unknown", source), /平台/);
  assert.throws(() => transcriptionCommand("submit", "douyin", "x".repeat(10001)), /10000/);
  assert.throws(() => transcriptionCommand("query", "douyin", "x".repeat(501)), /500/);
  assert.equal(transcriptionCommand("submit", "douyin", "x".repeat(10000)).body.url?.length, 10000);
  assert.equal(transcriptionCommand("query", "douyin", "x".repeat(500)).body.taskId?.length, 500);
});

test("a source is clickable only when the original is a pure safe HTTP(S) URL, never an extracted sharing URL", () => {
  for (const value of [source, "https://example.com/video\n", " https://example.com/video", "https://example.com/video ", "https://example.com/video\t", "https://example.com/video\n请查看", "//example.com/video", "javascript:alert(1)", "data:audio/mp3;base64,abc", "https://user:pass@example.com/video", null]) assert.equal(transcriptionSourceLink(value), null, String(value));
  assert.equal(transcriptionSourceLink("https://example.com/video?token=a%2Fb"), "https://example.com/video?token=a%2Fb");
  assert.equal(transcriptionSourceLink("http://cdn.example/video.mp4"), "http://cdn.example/video.mp4");
});

test("terminal progress can clear while actual and requested task IDs remain recoverable from saved ASR results", () => {
  const results = [saved(1, "transcription_task", { platform: "douyin", taskId }), saved(2, "transcription_task", { platform: "douyin", requestedTaskId: taskId, status: "processing" }), saved(3, "transcription", { platform: "douyin", requestedTaskId: taskId, status: "succeeded", text: "完成 😀" })];
  const facts = transcriptionTaskFacts({ progress: {}, inputs: { platform: "douyin", parameters: { url: source } }, results });
  assert.equal(facts.actualTaskId, taskId);
  assert.equal(facts.requestedTaskId, taskId);
  assert.equal(facts.executionTaskId, taskId);
  assert.equal(facts.latest?.id, 3);
  assert.equal(facts.latest?.kind, "transcription");
  const queryOnly = transcriptionTaskFacts({ progress: {}, inputs: { platform: "douyin", parameters: { taskId } }, results: [results[2]!] });
  assert.equal(queryOnly.actualTaskId, null);
  assert.equal(queryOnly.requestedTaskId, taskId);
  assert.equal(queryOnly.executionTaskId, taskId);
});

test("task derivation separates execution/request/received identities and ignores other platform or image records", () => {
  const results = [saved(5, "transcription", { platform: "douyin", taskId: "latest-actual", requestedTaskId: "saved-request", status: "succeeded" }), saved(3, "transcription_task", { platform: "douyin", taskId: "older" }), saved(9, "image_task", { platform: "douyin", taskId: "image-id" }), saved(8, "transcription", { platform: "kuaishou", taskId: "other-platform" })];
  const facts = transcriptionTaskFacts({ progress: { taskId: "execution-id" }, inputs: { platform: "douyin", parameters: { taskId: "input-request" } }, results });
  assert.equal(facts.executionTaskId, "execution-id");
  assert.equal(facts.actualTaskId, "latest-actual");
  assert.equal(facts.requestedTaskId, "input-request");
  assert.equal(facts.latest?.id, 5);
  assert.deepEqual(transcriptionTaskFacts({ progress: {}, inputs: { platform: "douyin" }, results: results.slice(2) }), { actualTaskId: null, requestedTaskId: null, executionTaskId: null, latest: null });
});

test("business-stage labels come from the run rather than an old processing response", () => {
  const processing = saved(1, "transcription_task", { platform: "douyin", status: "processing", requestedTaskId: taskId });
  const facts = transcriptionTaskFacts({ progress: {}, inputs: { platform: "douyin" }, results: [processing] });
  assert.equal(facts.latest?.data.status, "processing");
  assert.match(transcriptionRunStage("completed", "redfox.transcript.poll"), /已完成/);
  assert.match(transcriptionRunStage("stopped", "redfox.transcript.poll"), /已停止/);
  assert.match(transcriptionRunStage("failed", "redfox.transcript.poll"), /已结束/);
  assert.match(transcriptionRunStage("needs_review", "redfox.transcript.submit"), /核对/);
  assert.match(transcriptionRunStage("active", "redfox.transcript.submit"), /提交/);
  assert.match(transcriptionRunStage("waiting", "redfox.transcript.poll"), /下一次/);
});

test("provider states retain submission/processing/failure/success facts, never assume a missing state succeeded", () => {
  assert.match(transcriptionProviderStatus("transcription_task", { taskId }), /提交回执/);
  assert.match(transcriptionProviderStatus("transcription_task", { status: "processing" }), /处理中/);
  assert.match(transcriptionProviderStatus("transcription_task", { status: "failed", failReason: null }), /失败/);
  assert.match(transcriptionProviderStatus("transcription", { status: "succeeded" }), /成功/);
  assert.equal(transcriptionProviderStatus("transcription", {}), "未提供处理状态");
  assert.equal(transcriptionProviderStatus("transcription_task", { taskId, status: "unknown" }), "未提供处理状态");
});

test("full text and failure reasons distinguish absent, null, empty and valid text while preserving lines and emoji", () => {
  for (const key of ["text", "failReason"] as const) {
    assert.equal(transcriptionTextField({}, key).state, "absent");
    assert.equal(transcriptionTextField({ [key]: null }, key).state, "null");
    assert.deepEqual(transcriptionTextField({ [key]: "" }, key), { state: "text", text: "" });
    assert.equal(transcriptionTextField({ [key]: 0 }, key).state, "invalid");
  }
  const text = "  第一行 😀\n<script>仅文本</script>\n第二行  ";
  assert.deepEqual(transcriptionTextField({ text }, "text"), { state: "text", text });
  assert.deepEqual(transcriptionTextField({ failReason: "上游原始失败原因" }, "failReason"), { state: "text", text: "上游原始失败原因" });
});

test("processing and failed null/absent text are neutral history facts; missing successful text or illegal fields need review", () => {
  for (const status of ["processing", "failed"]) for (const data of [{ status }, { status, text: null }, { status, text: "" }]) {
    const view = transcriptionTextPresentation("transcription_task", data);
    assert.equal(view.needsReview, false);
    assert.equal(view.hasText, false);
  }
  for (const text of [undefined, null, "", "  "]) assert.equal(transcriptionTextPresentation("transcription", { status: "succeeded", ...(text === undefined ? {} : { text }) }).needsReview, true);
  assert.equal(transcriptionTextPresentation("transcription_task", { status: "processing", text: 0 }).needsReview, true);
  assert.equal(transcriptionTextPresentation("transcription", { status: "succeeded", text: " 完整 😀\n正文 " }).needsReview, false);
});

test("segment pages keep all text and huge millisecond strings reachable without rounding or truncating", () => {
  const stampSents = Array.from({ length: 63 }, (_, index) => ({ textSeg: `  分段 ${index} 😀\n下一行  `, start: index === 0 ? 0 : `${huge}${index}`, end: `${huge}${index + 1}` }));
  const data = { stampSents, timestampUnit: "milliseconds" }, all = [];
  for (let page = 0; page < 3; page++) {
    const result = transcriptionSegmentPage(data, page);
    assert.ok(result.rows.length <= 25);
    all.push(...result.rows);
  }
  assert.deepEqual(all, stampSents);
  assert.equal(all[1]?.start, `${huge}1`);
  assert.equal(all[0]?.start, 0);
  assert.equal(transcriptionSegmentPage(data, 2).end, 63);
  assert.equal(transcriptionSegmentPage(data, 2).rows.at(-1)?.textSeg, stampSents.at(-1)?.textSeg);
  assert.equal(data.stampSents.length, 63);
});

test("segment presentation clamps a stale page to available records without fabricating rows for null or missing arrays", () => {
  const data = { stampSents: [{ start: "0000", end: "0001", textSeg: "" }] };
  assert.deepEqual(transcriptionSegmentPage(data, 200).rows, data.stampSents);
  assert.equal(transcriptionSegmentPage(data, -1).page, 0);
  assert.equal(transcriptionSegmentPage(data, NaN).page, 0);
  assert.equal(transcriptionSegmentPage(data, 1, 0).rows[0]?.start, "0000");
  for (const data of [{}, { stampSents: null }, { stampSents: [] }]) {
    const page = transcriptionSegmentPage(data, 0);
    assert.equal(page.total, 0);
    assert.deepEqual(page.rows, []);
  }
});
