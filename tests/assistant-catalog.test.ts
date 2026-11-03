import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, symlink, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalog, candidates, resolveCandidate, validatePackage, taskHint, additionalFeeKinds } from "@aihot/backend/assistant/catalog";
import { actions as boundActions, skillNames } from "@aihot/backend/assistant/bindings";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
test("assistant fee disclosures follow only the admitted immutable module capabilities", async () => {
  for (const [actionId, expected] of [
    ["general-writing", []], ["xiaohongshu-write", ["search"]], ["xiaohongshu-rewrite", []],
    ["wechat-write", ["search"]], ["image-generator", ["image"]], ["ai-image-generator", ["image"]],
  ] as const) assert.deepEqual(await additionalFeeKinds(await candidates("creative", { actionId })), expected);
  const automatic = await candidates("creative");
  assert.deepEqual(await additionalFeeKinds(automatic), ["search", "image", "vision"]);
  const admittedTextOnly = automatic.filter(candidate => candidate.skillId === "general-writing");
  assert.deepEqual(await additionalFeeKinds(admittedTextOnly), [], "filtered-out capabilities do not reappear in the quote");
  assert.deepEqual(await additionalFeeKinds([]), []);
  await assert.rejects(additionalFeeKinds([{ ...automatic[0]!, moduleHash: "unavailable" }]), /原技能版本不可用/);
});
test("assistant catalogs bind package namespace, contracts, fixtures and profile scope", async () => {
  const packages = await catalog();
  assert.equal(packages.length, 8);
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
  const redfox = packages.find((p) => p.manifest.skillId === "xiaohongshu-creator" && p.manifest.version === "4")!;
  assert.equal(redfox.manifest.version, "4");
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
    if (id === "M1") assert(loadedEntry.includes(redfox.texts.get("adaptation")!));
    assert(!resolved.module.resources.includes("upstream-skill"), "archived full skill does not expose M3–M5");
    assert(!loadedEntry.includes(id === "M1" ? "## 5. M2 文案改写" : "## 4. M1 笔记生成"));
  }
  const creative = await candidates("creative"),
    xhs = await candidates("xiaohongshu");
  assert.equal(skillNames["image-generator"], "图片创作 · 帮我完善描述");
  assert.equal(skillNames["ai-image-generator"], "图片生成");
  assert.equal(boundActions.find(a => a.actionId === "image-generator")?.label, "图片创作 · 帮我完善描述");
  assert.equal(boundActions.find(a => a.actionId === "ai-image-generator")?.label, "图片生成");
  assert.equal(creative.length, 8);
  assert.equal(xhs.length, 3);
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

test("validated temporary packages enforce finite delivery dependencies after legitimate rehashing", async () => {
  const rehash = (manifest: any) => {
    for (const module of manifest.modules) {
      const { hash, ...body } = module;
      module.hash = sha256(stableJson({ ...body, resources: module.resources.map((id: string) => manifest.resources.find((r: any) => r.resourceId === id)) }));
    }
    const { manifestHash, packageHash, ...body } = manifest;
    manifest.manifestHash = sha256(stableJson(body));
    manifest.packageHash = sha256(stableJson({ manifestHash: manifest.manifestHash, resources: manifest.resources }));
    return manifest;
  };
  for (const directory of ["wechat-write", "xiaohongshu-creator", "ai-image-generator"]) {
    const dir = await mkdtemp(join(tmpdir(), "assistant-contract-"));
    try {
      await cp(new URL(`../packages/backend/src/assistant/skills/${directory}/`, import.meta.url), dir, { recursive: true });
      const original = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
      original.skillId = `fixture-${directory}`;
      const correct = rehash(original);
      assert.equal((await validatePackage(dir, correct)).manifest.skillId, correct.skillId);
      const missingCapability = structuredClone(correct);
      missingCapability.modules[0].tools = directory === "ai-image-generator" ? [] : ["save_draft"];
      // Keep the copied binding structurally coherent, with no script check masking the contract failure.
      const binding = JSON.parse(await readFile(join(dir, "binding.json"), "utf8"));
      binding.skillId = correct.skillId; binding.modules[0].actionId = `${correct.skillId}-action`;
      binding.modules[0].capabilities = directory === "ai-image-generator" ? [] : ["save-writing@1"];
      binding.modules[0].scriptBindings = [];
      await writeFile(join(dir, "binding.json"), JSON.stringify(binding));
      // XHS's historical generic writing contract cannot require research without an analyze capability.
      // Its negative is analyze present but its corresponding search missing.
      if (directory === "xiaohongshu-creator") missingCapability.modules[0].tools.push("analyze_xhs_research");
      await assert.rejects(validatePackage(dir, rehash(missingCapability)), { code: "contract_mismatch" });
      const wrongOutput = structuredClone(correct);
      wrongOutput.modules[0].outputKinds = directory === "ai-image-generator" ? ["text-draft"] : ["image"];
      await assert.rejects(validatePackage(dir, rehash(wrongOutput)), { code: "contract_mismatch" });
      if (directory === "wechat-write") {
        const wrongContract = structuredClone(correct);
        wrongContract.modules[0].deliveryContract = "writing-delivery@1";
        await assert.rejects(validatePackage(dir, rehash(wrongContract)), { code: "contract_mismatch" });
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  const coverDir=await mkdtemp(join(tmpdir(),"assistant-cover-contract-"));
  try{
    await cp(new URL("../packages/backend/src/assistant/skills/xiaohongshu-creator-v4/",import.meta.url),coverDir,{recursive:true});
    const original=JSON.parse(await readFile(join(coverDir,"manifest.json"),"utf8"));
    for(const capability of ["search_xhs_covers","analyze_xhs_covers","save_xhs_cover_plan"]){const changed=structuredClone(original);changed.modules[2].tools=changed.modules[2].tools.filter((t:string)=>t!==capability);await assert.rejects(validatePackage(coverDir,rehash(changed)),{code:"contract_mismatch"});}
    const changed=structuredClone(original);changed.modules[2].outputKinds=["image"];await assert.rejects(validatePackage(coverDir,rehash(changed)),{code:"contract_mismatch"});
    const noImage=structuredClone(original);noImage.modules[2].outputKinds=["xhs-cover-plan"];await assert.rejects(validatePackage(coverDir,rehash(noImage)),{code:"contract_mismatch"});
    const optional=structuredClone(original);optional.modules[2].tools=optional.modules[2].tools.filter((t:string)=>t!=="generate_image");await validatePackage(coverDir,rehash(optional));
  }finally{await rm(coverDir,{recursive:true,force:true});}
  assert.equal((await candidates("xiaohongshu", null, { "xiaohongshu-creator": "2" })).length, 2);
});

test("skill selection grants only that skill's profile modules while legacy actions stay exact", async () => {
  const skill = await candidates("creative", { skillId: "xiaohongshu-creator" });
  assert.deepEqual(skill.map(c => c.moduleId), ["M1", "M2", "M4"]);
  assert.deepEqual((await candidates("creative", { actionId: "xiaohongshu-rewrite" })).map(c => c.moduleId), ["M2"]);
  assert.deepEqual(await additionalFeeKinds(skill), ["search", "image", "vision"]);
  assert.deepEqual(await additionalFeeKinds(await candidates("creative", { actionId: "xiaohongshu-rewrite" })), []);
  await assert.rejects(candidates("xiaohongshu", { skillId: "wechat-write" }), /不支持此技能/);
  for (const bad of [{skillId:"xiaohongshu-creator",actionId:"xiaohongshu-rewrite"},{skillId:"xiaohongshu-creator",moduleId:"M1"},{}])
    await assert.rejects(candidates("creative", bad as never));
});
