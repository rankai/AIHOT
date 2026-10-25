import assert from "node:assert/strict";
import { test } from "node:test";
import { navigationLabel, presentationFromMatches } from "../app/lib/presentation.ts";
import { parsePresentation } from "@aihot/contracts/presentation";
import { DEFAULT_SITE_PRESENTATION } from "../app/lib/presentation.ts";
import { movePresentationItem, validPresentationPageSizes } from "../app/features/admin/presentation-draft.ts";

test("group moves preserve unrelated entries and the original draft", () => {
  const rows = [{ id: "all", visible: true }, { id: "leaderboard", visible: true }, { id: "hot", visible: false }, { id: "topics", visible: true }];
  const moved = movePresentationItem(rows, "topics", -1, ["all", "hot", "topics"]);
  assert.deepEqual(moved.map((row) => row.id), ["all", "leaderboard", "topics", "hot"]);
  assert.deepEqual(rows.map((row) => row.id), ["all", "leaderboard", "hot", "topics"]);
  assert.equal(moved[3]?.visible, false);
  assert.equal(movePresentationItem(rows, "all", -1, ["all", "hot", "topics"]), rows);
  assert.equal(movePresentationItem(rows, "topics", 1, ["all", "hot", "topics"]), rows);
});

test("all list sizes require whole numbers within 1 through 40", () => {
  assert(validPresentationPageSizes({ selected: 1, all: 40, videos: 20 }));
  for (const value of [0, 41, 1.5, NaN, Infinity]) {
    for (const key of ["selected", "all", "videos"]) assert(!validPresentationPageSizes({ selected: 20, all: 40, videos: 20, [key]: value }));
  }
});

test("saved preset names read through the root presentation with surface defaults intact", () => {
  const draft = structuredClone(DEFAULT_SITE_PRESENTATION);
  draft.navigation = draft.navigation.map((row) => row.id === "selected" ? { ...row, label: "  今日必读  " } : row);
  const saved = parsePresentation(draft);
  const root = presentationFromMatches([undefined, { id: "root", loaderData: { presentation: saved } }]);
  assert.equal(navigationLabel(root, "selected", "最新精选"), "今日必读");
  assert.equal(navigationLabel(root, "all", "全部"), "全部");
});
