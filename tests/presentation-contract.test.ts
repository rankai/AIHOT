import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PRESENTATION } from "@aihot/industry/presentation";
import { parsePresentation } from "@aihot/contracts/presentation";

test("presentation rejects unknown or duplicate IDs, hidden fixed entry and unsafe sizes", () => {
  assert.deepEqual(parsePresentation(DEFAULT_PRESENTATION), DEFAULT_PRESENTATION);
  const bad = [
    { ...DEFAULT_PRESENTATION, navigation: [...DEFAULT_PRESENTATION.navigation, { id: "javascript:alert(1)", visible: true }] },
    { ...DEFAULT_PRESENTATION, navigation: [...DEFAULT_PRESENTATION.navigation, DEFAULT_PRESENTATION.navigation[0]] },
    { ...DEFAULT_PRESENTATION, navigation: DEFAULT_PRESENTATION.navigation.map(row => ({ ...row, visible: false })) },
    { ...DEFAULT_PRESENTATION, navigation: [] },
    { ...DEFAULT_PRESENTATION, categories: [{ id: "unknown", visible: true }] },
    { ...DEFAULT_PRESENTATION, categories: [DEFAULT_PRESENTATION.categories[0], DEFAULT_PRESENTATION.categories[0]] },
    { ...DEFAULT_PRESENTATION, route: "/custom" },
    ...[0, 41, 1.5, "20", null].map(selected => ({ ...DEFAULT_PRESENTATION, pageSizes: { ...DEFAULT_PRESENTATION.pageSizes, selected } })),
  ];
  for (const input of bad) assert.throws(() => parsePresentation(input), { statusCode: 400 });
  for (const size of [1, 40]) assert.equal(parsePresentation({ ...DEFAULT_PRESENTATION, pageSizes: { selected: size, all: size, videos: size } }).pageSizes.selected, size);
});

test("navigation labels and custom definitions are normalized without widening the input contract", () => {
  const custom = { id: 'custom-12345678-1234-4234-8234-123456789abc', visible: false, label: ' 产品资讯 ', scope: 'all', category: 'retired-category', tag: ' Agent ', pageSize: 7 };
  const parseRow = (row: unknown) => parsePresentation({ ...DEFAULT_PRESENTATION, navigation: [...DEFAULT_PRESENTATION.navigation, row] }).navigation.at(-1);
  assert.deepEqual(parseRow(custom), { ...custom, label: '产品资讯', tag: 'Agent' });
  assert.deepEqual(parseRow({ ...custom, category: '', tag: '  ' }), { id: custom.id, visible: false, label: '产品资讯', scope: 'all', pageSize: 7 });
  for (const patch of [
    { id: 'custom-invalid' }, { id: 'custom-12345678-1234-4234-7234-123456789abc' },
    { label: '' }, { label: '字'.repeat(21) }, { label: '<b>name</b>' }, { label: 'line\nbreak' }, { label: 3 },
    { tag: 'entity:openai' }, { tag: '字'.repeat(61) }, { tag: ['Agent'] }, { category: '../all' },
    { scope: 'topic' }, { pageSize: 0 }, { pageSize: 41 }, { pageSize: 1.5 }, { pageSize: '4' },
    { visible: 'true' }, { url: '/all' }, { topic: 'agent' },
  ]) assert.throws(() => parseRow({ ...custom, ...patch }), { statusCode: 400 });
  assert.throws(() => parsePresentation({ ...DEFAULT_PRESENTATION, navigation: [...DEFAULT_PRESENTATION.navigation, custom, custom] }), { statusCode: 400 });
  for (const label of ['', '  ', '  新精选  ']) {
    const parsed = parsePresentation({ ...DEFAULT_PRESENTATION, navigation: DEFAULT_PRESENTATION.navigation.map(row => row.id === 'selected' ? { ...row, label } : row) });
    assert.deepEqual(parsed.navigation.find(row => row.id === 'selected'), { id: 'selected', visible: true, ...(label.trim() ? { label: label.trim() } : {}) });
  }
  assert.throws(() => parsePresentation({ ...DEFAULT_PRESENTATION, navigation: DEFAULT_PRESENTATION.navigation.map(row => ({ ...row, scope: 'all' })) }), { statusCode: 400 });
});
