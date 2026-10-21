import assert from "node:assert/strict";
import { test } from "node:test";
import { imageTaskId } from "../app/features/admin/image-types.ts";

test("completed generation keeps its task identity after progress has been cleared", () => {
  const results = [
    { kind: "image_task", data: { taskId: "generated-task", status: "completed" } },
    { kind: "image", data: { taskId: "output-only-task" } },
  ];
  assert.equal(imageTaskId({ progress: {}, inputs: { parameters: { prompt: "two images" } }, results }), "generated-task");
  assert.equal(imageTaskId({ progress: {}, inputs: {}, results: [results[1]!] }), null);
});
test("current progress and explicit query inputs retain priority over historical task records", () => {
  const results = [{ kind: "image_task", data: { taskId: "historical-task" } }];
  assert.equal(imageTaskId({ progress: { taskId: "current-task" }, inputs: { parameters: { taskId: "input-task" } }, results }), "current-task");
  assert.equal(imageTaskId({ progress: {}, inputs: { parameters: { taskId: "input-task" } }, results }), "input-task");
});
