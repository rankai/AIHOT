import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, symlink, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalog, candidates, resolveCandidate, validatePackage, taskHint } from "@aihot/backend/assistant/catalog";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
test("assistant catalogs bind package namespace, contracts, fixtures and profile scope", async () => {
  const packages = await catalog();
  assert.equal(packages.length, 2);
  for (const p of packages)
    for (const m of p.manifest.modules)
      for (const ref of m.fixtures) {
        const [id, key] = ref.split("#");
        const fixture = JSON.parse(p.texts.get(id!)!)[key!];
        assert.equal(fixture.moduleId, m.moduleId);
        for (const text of fixture.requiredEntryText ?? [])
          assert(p.texts.get(m.entryResource)!.includes(text), `${m.moduleId} must actually load original rule: ${text}`);
        assert.equal(
          fixture.case === "missing-input" ? fixture.expected : m.outputKinds.includes(fixture.expected),
          fixture.case === "missing-input" ? "ask_question" : true,
        );
      }
  const redfox = packages.find((p) => p.manifest.skillId === "xiaohongshu-creator")!;
  assert.equal(redfox.manifest.version, "2");
  assert.equal(redfox.manifest.source.kind, "external");
  if (redfox.manifest.source.kind === "external") {
    assert.equal(redfox.manifest.source.license, "NOASSERTION");
    assert.equal(redfox.manifest.source.usageBasis, "user-directed-local-evaluation");
    assert.equal(redfox.manifest.source.commit, "d2e24f02340a440a73a96aa6ad6a65f681fba89f");
  }
  const upstreamManifest = JSON.parse(await readFile(new URL("../docs/reviews/2026-10-30-xiaohongshu-skill-manifest.json", import.meta.url), "utf8"));
  for (const [id, path] of [["upstream-skill", "SKILL.md"], ["platform-rules", "assets/platform-rules.md"], ["hot-article-format", "references/xhs_hot_article_format.md"]]) {
    const original = upstreamManifest.files.find((file: { path: string }) => file.path === path);
    assert.equal(sha256(redfox.texts.get(id!)!), original.sha256, `${path} remains byte-for-byte upstream`);
  }
  const originalSkill = redfox.texts.get("upstream-skill")!;
  const globalRules = originalSkill.slice(originalSkill.indexOf("### 3.2 "), originalSkill.indexOf("## 4. M1 "));
  for (const [id, start, end, reference] of [
    ["M1", "## 4. M1 ", "## 5. M2 ", "hot-article-format"],
    ["M2", "## 5. M2 ", "## 6. M3 ", "platform-rules"],
  ]) {
    const resolved = await resolveCandidate(await candidates("xiaohongshu"), "xiaohongshu-creator", id!);
    const loadedEntry = resolved.skill.texts.get(resolved.module.entryResource)!;
    assert(loadedEntry.includes(globalRules));
    assert(loadedEntry.includes(originalSkill.slice(originalSkill.indexOf(start!), originalSkill.indexOf(end!))));
    assert(loadedEntry.includes(redfox.texts.get(reference!)!), `${id} inlines its complete upstream reference`);
    assert(loadedEntry.includes(redfox.texts.get("adaptation")!));
    assert(!resolved.module.resources.includes("upstream-skill"), "archived full skill does not expose M3–M5");
    assert(!loadedEntry.includes(id === "M1" ? "## 5. M2 文案改写" : "## 4. M1 笔记生成"));
  }
  const creative = await candidates("creative"),
    xhs = await candidates("xiaohongshu");
  assert.equal(creative.length, 3);
  assert.equal(xhs.length, 2);
  assert(xhs.every((c) => c.skillId === "xiaohongshu-creator"));
  await assert.rejects(() => resolveCandidate(xhs, "general-writing", "write"));
  await assert.rejects(() => resolveCandidate(xhs, "xiaohongshu-creator", "M3"));
  assert.throws(() => taskHint("creative", { actionId: "wechat" }));
  assert.throws(() => taskHint("xiaohongshu", { actionId: "general-writing" }));
  const dir = await mkdtemp(join(tmpdir(), "assistant-catalog-"));
  try {
    const original = new URL("../packages/backend/src/assistant/skills/general-writing/", import.meta.url);
    await cp(original, dir, { recursive: true });
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    const changed = structuredClone(manifest);
    changed.skillId = "fixture-writing";
    changed.name = "Fixture";
    const { manifestHash, packageHash, ...body } = changed;
    changed.manifestHash = sha256(stableJson(body));
    changed.packageHash = sha256(stableJson({ manifestHash: changed.manifestHash, resources: changed.resources }));
    const fixture = await validatePackage(dir, changed);
    const m = fixture.manifest.modules[0]!;
    const candidate = {
      skillId: changed.skillId,
      version: changed.version,
      packageHash: changed.packageHash,
      moduleId: m.moduleId,
      moduleVersion: m.version,
      moduleHash: m.hash,
      description: m.description,
    };
    const resolved = await resolveCandidate([...creative, candidate], candidate.skillId, "write", [
      ...packages,
      fixture,
    ]);
    assert.equal(resolved.skill.manifest.skillId, "fixture-writing");
    assert.notEqual(resolved.skill, packages[0]);
    await assert.rejects(() => validatePackage(dir, { ...manifest, formatVersion: 2 }));
    const escaped = structuredClone(manifest);
    escaped.resources[0].path = "../outside.md";
    await assert.rejects(() => validatePackage(dir, escaped));
    await writeFile(join(dir, "rules.md"), "tampered");
    await assert.rejects(() => validatePackage(dir, manifest));
    await rm(join(dir, "rules.md"));
    await symlink("/etc/hosts", join(dir, "rules.md"));
    await assert.rejects(() => validatePackage(dir, manifest));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
