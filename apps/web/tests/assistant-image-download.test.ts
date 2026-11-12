import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantArtifact } from "@aihot/contracts/assistant";
import { exactImageFile, ImageDownloadError, imageDownloadBlob } from "../app/features/assistant/image-download-data.ts";

const image: AssistantArtifact = {
  artifactId: "cover", version: 1, kind: "image", schemaVersion: 1, sources: [],
  content: { title: "封面", body: "", intent: "draft", titles: [], tags: [], sources: [], scope: "本地样本", partial: false, fileKey: "generated/old.png" },
};

test("image download resolves only the requested artifact, version and kind", () => {
  const newer = { ...image, version: 2, content: { ...image.content, fileKey: "generated/new.png" } };
  assert.equal(exactImageFile([newer, image], image), "generated/old.png");
  assert.equal(exactImageFile([image, newer], newer), "generated/new.png");
  for (const versions of [[], [newer], [{ ...image, artifactId: "other" }], [{ ...image, kind: "text-draft" as const }],
    [{ ...image, content: { ...image.content, fileKey: "" } }], [{ ...image, content: { ...image.content, fileKey: " " } }]]) {
    assert.throws(() => exactImageFile(versions, image), /image_version_unavailable/);
  }
});

test("image download reads the protected exact file and preserves its bytes", async (t) => {
  const controller = new AbortController();
  const bytes = new Uint8Array([137, 80, 78, 71]);
  t.mock.method(globalThis, "fetch", async (path: string, options: RequestInit) => {
    assert.equal(path, "/api/tools/assets/generated%2Fold.png/content");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.signal, controller.signal);
    return new Response(bytes, { headers: { "content-type": "image/png" } });
  });
  const blob = await imageDownloadBlob(image.content.fileKey!, controller.signal);
  assert.equal(blob.type, "image/png");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
});

test("image download rejects denied, missing, non-image and empty asset responses", async (t) => {
  const responses = [
    new Response("private internal detail", { status: 401 }), new Response("private internal detail", { status: 403 }),
    new Response("private internal detail", { status: 404 }), new Response("private internal detail", { status: 503 }),
    new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
    new Response("", { headers: { "content-type": "image/png" } }),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  for (const status of [401, 403, 404, 503, 0, 0]) {
    await assert.rejects(imageDownloadBlob("file", new AbortController().signal), (cause) =>
      cause instanceof ImageDownloadError && cause.status === status && !cause.message.includes("private"));
  }
});

test("cancelled image reads never return a blob even if the transport resolves late", async (t) => {
  const before = new AbortController();
  before.abort();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("image", { headers: { "content-type": "image/png" } }));
  await assert.rejects(imageDownloadBlob("file", before.signal), { name: "AbortError" });
  assert.equal(fetchMock.mock.callCount(), 0);

  const duringResponse = new AbortController();
  fetchMock.mock.mockImplementation(async () => {
    duringResponse.abort();
    return new Response("image", { headers: { "content-type": "image/png" } });
  });
  await assert.rejects(imageDownloadBlob("file", duringResponse.signal), { name: "AbortError" });

  const duringBlob = new AbortController();
  fetchMock.mock.mockImplementation(async () => ({
    ok: true, headers: new Headers({ "content-type": "image/png" }),
    blob: async () => { duringBlob.abort(); return new Blob(["image"], { type: "image/png" }); },
  }) as Response);
  await assert.rejects(imageDownloadBlob("file", duringBlob.signal), { name: "AbortError" });
});
