import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareAdminBody } from "../app/features/admin/action-body.ts";
import type { PlatformOperation } from "../app/features/admin/platform-types.ts";
import { isMediaToolResult, mediaToolChoices, mediaToolCommand, mediaToolFormats, mediaToolLink, mediaToolMetadataBodies, mediaToolMetadataLinks, mediaToolMetadataRows, mediaToolResourceLinks, mediaToolResourceRows, mediaToolSpec, mediaToolTextView } from "../app/features/admin/media-tool-data.ts";

const media = ["9Q2PQBKU", "AWUTFI4V", "D52IUEIM", "7UW1PT1F", "MQMDU19Q", "QPNFJRG1", "U2NJ13MW", "0W27H3O6", "0ZIWOO8P", "CWX77QIH", "UUSP1G1P"];
const subtitles = ["API_1792053861083", "API_1792051516512"], check = "API_1791881343238";
const all = [...media, ...subtitles, check], huge = "000900719925474099312345";
const share = "  完整分享文案 😀\n请看 https://example.com/video?raw=a%2Fb\n尾部空白  ";
function operation(id: string): PlatformOperation {
  const text = id === check;
  return { id, platform: "tools", label: id, purpose: "fixed query", schedulableType: null, fields: [{ name: text ? "content" : "url", label: text ? "待检查文本" : "链接或分享文案", type: "string", required: true, constraints: { maxLength: text ? 2999 : 10000 } }] };
}

test("fourteen fixed tools keep exact group/purpose/estimated-price boundaries and exclude arbitrary catalog entries", () => {
  assert.equal(all.length, 14);
  for (const id of media) assert.deepEqual(mediaToolSpec(id), { group: "media", purpose: "media", estimatedCny: id === "9Q2PQBKU" ? 0.12 : 0.06, inputName: "url" });
  for (const id of subtitles) assert.deepEqual(mediaToolSpec(id), { group: "subtitle", purpose: "transcript", estimatedCny: 0.06, inputName: "url" });
  assert.deepEqual(mediaToolSpec(check), { group: "text-check", purpose: "query", estimatedCny: 0.06, inputName: "content" });
  assert.equal(mediaToolSpec("8DCJW2ZF"), null);
  assert.equal(mediaToolSpec(undefined), null);
  const choices = all.map(operation);
  assert.deepEqual(mediaToolChoices([...choices, { ...operation("unknown"), platform: "tools" }, { ...operation(media[0]!), platform: "bilibili" }]), choices);
});

test("all tool commands retain one raw multiline parameter and never emit unrelated identities or generic input fields", () => {
  for (const id of all) {
    const command = mediaToolCommand(operation(id), share), name = id === check ? "content" : "url";
    assert.deepEqual(command, { operationId: id, parameters: { [name]: share } });
    const wire = JSON.parse(String(prepareAdminBody(command).body));
    assert.equal(wire.parameters[name], share);
    assert.deepEqual(Object.keys(wire).sort(), ["operationId", "parameters"]);
    assert.deepEqual(Object.keys(wire.parameters), [name]);
  }
});

test("blank input does not inject a descriptor sample; exact 2999/10000 raw character limits are checked", () => {
  for (const id of [media[0]!, check]) {
    const op = operation(id), max = op.fields[0]!.constraints!.maxLength!;
    const withDefault = { ...op, fields: [{ ...op.fields[0]!, default: "do-not-inject" }] };
    for (const value of ["", " ", "\n\t"]) assert.throws(() => mediaToolCommand(withDefault, value));
    assert.equal(Object.values(mediaToolCommand(op, "x".repeat(max)).parameters)[0]!.length, max);
    assert.throws(() => mediaToolCommand(op, "x".repeat(max + 1)), new RegExp(String(max)));
  }
  assert.throws(() => mediaToolCommand({ ...operation(check), platform: "weibo" }, "text"));
  assert.throws(() => mediaToolCommand(operation("unlisted"), "text"));
  assert.throws(() => mediaToolCommand({ ...operation(check), fields: [{ ...operation(check).fields[0]!, name: "apiKey" }] }, "text"));
});

test("result dispatch requires the known operation, tools platform and matching group and kind", () => {
  for (const id of all) {
    const spec = mediaToolSpec(id)!;
    const data = { platform: "tools", operationId: id, group: spec.group };
    assert.equal(isMediaToolResult(spec.group === "media" ? "media_resource" : spec.group === "subtitle" ? "subtitle_track" : "text_check", data), true);
    assert.equal(isMediaToolResult("query_summary", data), spec.group !== "text-check");
    for (const kind of ["transcription", "transcription_task", "article", "account", "image", "bilibili_work", "social_comment"]) assert.equal(isMediaToolResult(kind, data), false);
    assert.equal(isMediaToolResult("media_resource", { ...data, platform: "bilibili" }), false);
    assert.equal(isMediaToolResult("media_resource", { ...data, group: "unknown" }), false);
  }
  assert.equal(isMediaToolResult("subtitle_track", { platform: "tools", operationId: media[0], group: "media" }), false);
  assert.equal(isMediaToolResult("text_check", { platform: "tools", operationId: "unlisted", group: "text-check" }), false);
});

test("resource facts retain unknown type, null duration as unknown, zero seconds, large strings and actual audio extension", () => {
  assert.deepEqual(mediaToolResourceRows({ reportedType: "unknown-provider-type", durationSeconds: null, record: { audioExt: "m4a" } }), [["实际资源类型（reportedType）", "unknown-provider-type"], ["时长 durationSeconds（秒）", "未知（上游 null，不是 0 秒）"], ["音频格式 audioExt（实收）", "m4a"]]);
  assert.ok(mediaToolResourceRows({ reportedType: "image", durationSeconds: 0, record: {} }).some(([key, value]) => key.includes("durationSeconds") && value === "0"));
  assert.ok(mediaToolResourceRows({ durationSeconds: huge, record: {} }).some(([, value]) => value === huge));
  assert.deepEqual(mediaToolResourceRows({ record: {} }), []);
});

test("media addresses use the provided safe resource field and cannot upgrade raw unsafe or blocked links to anchors", () => {
  const links = mediaToolResourceLinks({ resourceUrl: "https://cdn.example/video.mp4", record: { downloadUrl: "https://cdn.example/video.mp4", coverUrl: "https://user:pass@cdn.example/cover.jpg", cover: null } });
  assert.deepEqual(links.map(link => link.url), ["https://cdn.example/video.mp4", null, null]);
  assert.equal(links[1]?.reportedValue, "https://user:pass@cdn.example/cover.jpg");
  assert.equal(mediaToolResourceLinks({ resourceUrl: null, record: { downloadUrl: "https://cdn.example/video.mp4" } })[0]?.url, null);
  for (const value of ["javascript:alert(1)", "data:audio/mp3;base64,abc", "//cdn.example/file", "https://user@cdn.example/file"]) assert.equal(mediaToolLink("resource", value).url, null);
  assert.equal(mediaToolLink("resource", "raw-report", "http://cdn.example/file").reportedValue, "raw-report");
});

test("subtitle format rows keep every format and both reported and safe URLs, never infer file contents or timebase", () => {
  const data = { formats: [{ format: "srt", reportedUrl: "https://subtitle.example/a.srt", resourceUrl: "https://subtitle.example/a.srt" }, { format: "json3", reportedUrl: "javascript:bad", resourceUrl: null }, { format: "unknown-format", reportedUrl: "//subtitle.example/file", resourceUrl: "https://user@subtitle.example/file" }] };
  const formats = mediaToolFormats(data);
  assert.deepEqual(formats.map(row => row.format), ["srt", "json3", "unknown-format"]);
  assert.deepEqual(formats.map(row => row.link.url), ["https://subtitle.example/a.srt", null, null]);
  assert.equal(formats[1]?.link.reportedValue, "javascript:bad");
  assert.equal(formats[1]?.link.resourceValue, null);
  assert.deepEqual(mediaToolFormats({ formats: [] }), []);
});

test("zero-count metadata stays readable; IDs/site/input scope and raw ambiguous imageUrls do not become identities or media", () => {
  const rawImageUrls = '["https://cdn.example/image.jpg", malformed';
  const data = { count: 0, group: "media", requestedInput: { url: share }, reportedMetadata: { title: "Metadata only", site: "reported-site", id: huge, platform: "raw-platform", awemeType: "image", audioExt: "m4a", imageUrls: rawImageUrls } };
  const rows = mediaToolMetadataRows(data);
  for (const value of ["Metadata only", "reported-site", huge, "raw-platform", "image", "m4a", rawImageUrls]) assert.ok(rows.some(([, text]) => text === value));
  assert.equal(rows.some(([, value]) => value === share), false);
  assert.equal(data.count, 0);
  assert.deepEqual(mediaToolMetadataLinks(data), []);
  assert.equal(mediaToolMetadataRows({ group: "media", reportedMetadata: { imageUrls: ["one", "two"] } })[0]?.[1], '["one","two"]');
});

test("subtitle description remains description, UTC strings and duration seconds remain unconverted and nullable", () => {
  const description = "视频简介\n不是字幕 😀 <b>纯文本</b>", createdAt = "2020-01-01T12:00:00.000Z";
  const data = { group: "subtitle", reportedMetadata: { description, duration: 0, createdAt, id: huge, title: "字幕元数据" } };
  assert.deepEqual(mediaToolMetadataBodies(data), [["description", description]]);
  const rows = mediaToolMetadataRows(data);
  assert.ok(rows.some(([label, value]) => label === "原始 duration（秒）" && value === "0"));
  assert.ok(rows.some(([label, value]) => label.includes("createdAt") && value === createdAt));
  assert.ok(mediaToolMetadataRows({ ...data, reportedMetadata: { duration: null } }).some(([, value]) => value.includes("未知")));
  assert.equal(mediaToolMetadataBodies({ reportedMetadata: { text: "raw upstream text is not subtitle contents" } }).length, 0);
});

test("only server-owned sanitizedHighlightHtml enters the HTML selection; raw record.content never supplies a fallback", () => {
  const original = '原始文本 <script>alert("unsafe")</script>\n第二行 😀';
  const record = { content: '<img src=x onerror="alert(1)"><script>alert(2)</script>', originalContent: "not-selected-record-field" };
  const safe = '<span class="banned-word">已标注</span>文字';
  const view = mediaToolTextView({ originalContent: original, sanitizedHighlightHtml: safe, record });
  assert.equal(view.highlightHtml, safe);
  assert.equal(view.original, original);
  for (const sanitizedHighlightHtml of [undefined, null, 0, ""]) {
    const fallback = mediaToolTextView({ originalContent: original, record, ...(sanitizedHighlightHtml === undefined ? {} : { sanitizedHighlightHtml }) });
    assert.equal(fallback.highlightHtml, null);
    assert.equal(fallback.original, original);
  }
  assert.equal(mediaToolTextView({ record }).highlightHtml, null);
  assert.equal(mediaToolTextView({ record }).original, null);
});

test("text-check hit types preserve duplicate and empty strings without deduplication, new scoring or rule decisions", () => {
  const types = ["禁用词", "行业禁用词", "禁用词", ""];
  const view = mediaToolTextView({ originalContent: "text", prohibitedWordsType: types });
  assert.deepEqual(view.types, types);
  assert.deepEqual(Object.keys(view).sort(), ["highlightHtml", "original", "types"]);
  assert.deepEqual(mediaToolTextView({ originalContent: "text", prohibitedWordsType: [] }).types, []);
});

test("metadata URLs are media/cover facts only and receive the same HTTP(S)/userinfo checks as resource URLs", () => {
  const data = { reportedMetadata: { cover: null, videoUrl: "https://cdn.example/video.mp4", audioUrl: "https://user:pass@cdn.example/audio.m4a", thumbnailUrl: "javascript:alert(1)" }, requestedInput: { url: "https://example.com/actual-input" } };
  const links = mediaToolMetadataLinks(data);
  assert.deepEqual(links.map(link => link.url), [null, "https://cdn.example/video.mp4", null, null]);
  assert.equal(links.some(link => link.reportedValue === data.requestedInput.url), false);
  assert.equal(links.length, 4);
});
