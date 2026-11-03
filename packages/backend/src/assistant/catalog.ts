import { bindings, bindingScope, capabilities, actions, skillNames, currentSkillVersions } from "./bindings.ts";
export { actions, skillNames, currentSkillVersions } from "./bindings.ts";
import { readFile, realpath, lstat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sha256, stableJson } from "../lib/ids.ts";
import { AccountError } from "../users/accounts.ts";
import type { AssistantId, AssistantTaskHint, AssistantAdditionalFeeKind, AssistantSkillSelection } from "@aihot/contracts/assistant";
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const Resource = z
  .object({
    resourceId: Id,
    path: z.string().min(1),
    type: z.enum(["text/markdown", "text/plain", "application/json"]),
    bytes: z.number().int().min(1).max(131072),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const Module = z
  .object({
    moduleId: Id,
    version: z.string(),
    hash: z.string(),
    description: z.string(),
    inputSchema: z.enum(["writing-input@1", "image-input@1"]),
    toolContractVersion: z.literal(1),
    outputSchemaVersion: z.literal(1),
    deliveryContract: z.enum(["writing-delivery@1", "wechat-research-writing@1", "image-delivery@1", "xhs-cover-delivery@1"]),
    entryResource: Id,
    resources: z.array(Id),
    tools: z.array(z.enum(["save_draft", "save_xhs_cover_plan", "analyze_xhs_covers", "search_xhs_covers", "search_xhs_notes", "analyze_xhs_research", "search_wechat_articles", "analyze_wechat_research", "generate_image"])),
    outputKinds: z.array(z.enum(["text-draft", "xhs-note", "image", "xhs-cover-plan"])),
    modelCapabilities: z.array(z.literal("text-tools")),
    fixtures: z.array(z.string()).min(3),
  })
  .strict();
export const Manifest = z
  .object({
    formatVersion: z.literal(1),
    skillId: Id,
    version: z.string(),
    manifestHash: z.string(),
    packageHash: z.string(),
    name: z.string(),
    description: z.string(),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("owned"), license: z.literal("MIT"), maintainer: z.string(), review: z.string() }).strict(),
      z.object({
        kind: z.literal("external"), url: z.string().url(), commit: z.string().regex(/^[a-f0-9]{40}$/),
        license: z.enum(["NOASSERTION", "MIT"]), usageBasis: z.literal("user-directed-local-evaluation"),
        maintainer: z.string(), review: z.string(),
      }).strict(),
    ]),
    modules: z.array(Module).min(1),
    resources: z.array(Resource).min(1),
  })
  .strict();
export type Skill = z.infer<typeof Manifest>;
export interface Candidate {
  skillId: string;
  version: string;
  packageHash: string;
  moduleId: string;
  moduleVersion: string;
  moduleHash: string;
  description: string;
}
export interface LoadedSkill {
  manifest: Skill;
  texts: Map<string, string>;
}
export const catalogError = (code: string, message: string) => new AccountError(409, code, message);
export async function validatePackage(root: string, raw: unknown): Promise<LoadedSkill> {
  if (Buffer.byteLength(stableJson(raw)) > 65536) throw catalogError("context_limit", "技能目录过大");
  const manifest = Manifest.parse(raw),
    texts = new Map<string, string>();
  if (
    new Set(manifest.modules.map((m) => m.moduleId)).size !== manifest.modules.length ||
    new Set(manifest.resources.map((r) => r.resourceId)).size !== manifest.resources.length
  )
    throw catalogError("integrity_mismatch", "包内身份重复");
  const realRoot = await realpath(root);
  let total = 0;
  for (const resource of manifest.resources) {
    if (isAbsolute(resource.path) || resource.path.split(/[\\/]/).includes(".."))
      throw catalogError("scope_denied", "资源路径越界");
    const path = resolve(realRoot, resource.path),
      real = await realpath(path);
    if (
      relative(realRoot, real).startsWith("..") ||
      isAbsolute(relative(realRoot, real)) ||
      (await lstat(path)).isSymbolicLink()
    )
      throw catalogError("scope_denied", "资源路径越界");
    const bytes = await readFile(real);
    total += bytes.length;
    if (bytes.length !== resource.bytes || sha256(bytes.toString("utf8")) !== resource.sha256 || total > 1048576)
      throw catalogError("integrity_mismatch", "资源完整性不符");
    texts.set(resource.resourceId, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  for (const module of manifest.modules) {
    for (const reference of module.fixtures) {
      const [resourceId, name] = reference.split("#");
      if (!resourceId || !name || !texts.has(resourceId) || !Object.hasOwn(JSON.parse(texts.get(resourceId)!), name))
        throw catalogError("resource_missing", "模块验收fixture不存在");
    }

    if (!module.resources.includes(module.entryResource) || module.resources.some((id) => !texts.has(id)))
      throw catalogError("resource_missing", "模块资源不存在");
    // These finite delivery contracts require real capabilities, independent of package identity.
    const hasTools = (...tools: string[]) => tools.every(tool => (module.tools as string[]).includes(tool));
    if ((hasTools("generate_image") && !module.outputKinds.includes("image")) || ((module.deliveryContract === "xhs-cover-delivery@1" || hasTools("save_xhs_cover_plan")) &&
        (module.deliveryContract !== "xhs-cover-delivery@1" || !hasTools("search_xhs_covers","analyze_xhs_covers","save_xhs_cover_plan") || !module.outputKinds.includes("xhs-cover-plan"))) || ((module.deliveryContract === "wechat-research-writing@1" || module.tools.includes("analyze_wechat_research")) &&
        (module.deliveryContract !== "wechat-research-writing@1" || !hasTools("search_wechat_articles", "analyze_wechat_research", "save_draft") || !module.outputKinds.includes("text-draft"))) ||
      (module.deliveryContract === "image-delivery@1" &&
        (!hasTools("generate_image") || !module.outputKinds.includes("image"))) ||
      (module.tools.includes("analyze_xhs_research") &&
        (module.deliveryContract !== "writing-delivery@1" || !hasTools("search_xhs_notes", "save_draft") || !module.outputKinds.includes("xhs-note"))))
      throw catalogError("contract_mismatch", "交付合同缺少必要能力或作品类型");
    const { hash, ...body } = module;
    if (
      hash !==
      sha256(
        stableJson({
          ...body,
          resources: module.resources.map((id) => manifest.resources.find((r) => r.resourceId === id)),
        }),
      )
    )
      throw catalogError("integrity_mismatch", "模块版本不符");
  }
  const { manifestHash, packageHash, ...body } = manifest;
  if (
    manifestHash !== sha256(stableJson(body)) ||
    packageHash !== sha256(stableJson({ manifestHash, resources: manifest.resources }))
  )
    throw catalogError("integrity_mismatch", "技能版本不符");
  return { manifest, texts };
}
const root = fileURLToPath(new URL("./skills/", import.meta.url));
let cache: Promise<LoadedSkill[]> | undefined;
export function catalog(): Promise<LoadedSkill[]> {
  return (cache ??= Promise.all(
    bindings.map(async (binding) => {
      const loaded = await validatePackage(resolve(root, binding.directory), JSON.parse(await readFile(resolve(root, binding.directory, "manifest.json"), "utf8")));
      if (loaded.manifest.skillId !== binding.skillId || loaded.manifest.version !== binding.version) throw catalogError("integrity_mismatch", "绑定版本不符");
      for (const bound of binding.modules) {
        const module = loaded.manifest.modules.find(m => m.moduleId === bound.moduleId);
        if (!module || module.entryResource !== bound.entry || module.inputSchema !== bound.inputContract || module.deliveryContract !== bound.deliveryContract ||
          stableJson(module.tools) !== stableJson(bound.capabilities.map(c => capabilities[c])) ||
          stableJson(module.resources) !== stableJson([bound.entry, ...bound.references]) ||
          bound.scriptBindings.some(script => !bound.capabilities.includes(script.capability) || !loaded.manifest.resources.some(r => r.path === script.path)))
          throw catalogError("integrity_mismatch", "绑定与已验证模块合同不符");
      }
      if (binding.modules.length !== loaded.manifest.modules.length) throw catalogError("integrity_mismatch", "绑定模块缺失");
      return loaded;
    }),
  ));
}
export const profiles = {
  creative: {
    id: "creative",
    version: "1",
    name: "创作助手",
    welcome: "提供材料，起草、列提纲或改写；也可选择小红书或公众号创作。",
    ...bindingScope("creative"),
  },
  xiaohongshu: {
    id: "xiaohongshu",
    version: "1",
    name: "小红书助手",
    welcome: "根据你的材料写笔记或改写原稿。创作先检索真实笔记并分析规律；改写使用原稿。",
    ...bindingScope("xiaohongshu"),
  },
} as const;
export function profile(id: unknown) {
  const key = z.enum(["creative", "xiaohongshu"]).parse(id);
  return profiles[key];
}
export function taskHint(id: AssistantId, raw: unknown): AssistantTaskHint | null {
  if (raw === null || raw === undefined) return null;
  const hint = z
    .object({ actionId: z.string().refine(value => actions.some(a => a.actionId === value)) })
    .strict()
    .parse(raw);
  if (!profileActions(id).some(a => a.actionId === hint.actionId))
    throw catalogError("scope_denied", "当前助手不支持此动作");
  return hint;
}
export const SkillSelection = z.union([
  z.object({ skillId: Id }).strict(), z.object({ actionId: Id }).strict(),
]);
export function skillSelection(id: AssistantId, raw: unknown): AssistantSkillSelection | null {
  if (raw === undefined || raw === null) return null;
  const selected = SkillSelection.parse(raw);
  if ("actionId" in selected) taskHint(id, selected);
  else if (!(profile(id).skills as readonly string[]).includes(selected.skillId))
    throw catalogError("scope_denied", "当前助手不支持此技能");
  return selected;
}
export const registeredSkillIds = Object.keys(currentSkillVersions).sort();
export function profileActions(id: AssistantId) {
  return actions.filter(a => a.profiles.includes(id));
}
export async function candidates(id: AssistantId, selection?: AssistantSkillSelection | null, versions = currentSkillVersions): Promise<Candidate[]> {
  const p = profile(id);
  const selected = skillSelection(id, selection);
  const binding = selected && "actionId" in selected ? actions.find(a => a.actionId === selected.actionId) : null;
  return (await catalog())
    .filter((s) => (p.skills as readonly string[]).includes(s.manifest.skillId))
    .filter((s) => s.manifest.version === versions[s.manifest.skillId])
    .filter((s) => !selected || !("skillId" in selected) || s.manifest.skillId === selected.skillId)
    .flatMap(({ manifest: s }) =>
      s.modules
        .filter((m) => ((p.modules as Record<string, readonly string[]>)[s.skillId] ?? []).includes(m.moduleId))
        .filter((m) => !selected || "skillId" in selected || (binding?.skillId === s.skillId && binding.moduleId === m.moduleId))
        .map((m) => ({
          skillId: s.skillId,
          version: s.version,
          packageHash: s.packageHash,
          moduleId: m.moduleId,
          moduleVersion: m.version,
          moduleHash: m.hash,
          description: m.description,
        })),
    );
}
export async function resolveCandidate(
  candidates: Candidate[],
  skillId: string,
  moduleId: string,
  packages?: LoadedSkill[],
) {
  const candidate = candidates.find((c) => c.skillId === skillId && c.moduleId === moduleId);
  if (!candidate) throw catalogError("scope_denied", "技能模块不在本回合授权目录中");
  const skill = (packages ?? (await catalog())).find(
    (s) =>
      s.manifest.skillId === skillId &&
      s.manifest.version === candidate.version &&
      s.manifest.packageHash === candidate.packageHash,
  );
  const module = skill?.manifest.modules.find(
    (m) => m.moduleId === moduleId && m.hash === candidate.moduleHash && m.version === candidate.moduleVersion,
  );
  if (!skill || !module) throw catalogError("version_unavailable", "原技能版本不可用，请核对");
  return { candidate, skill, module };
}
/** Fee disclosure follows the admitted immutable modules, without predicting tool use. */
export async function additionalFeeKinds(candidates: Candidate[]): Promise<AssistantAdditionalFeeKind[]> {
  const kinds = new Set<AssistantAdditionalFeeKind>();
  for (const candidate of candidates) {
    const { module } = await resolveCandidate([candidate], candidate.skillId, candidate.moduleId);
    if (module.tools.some(tool => tool === "search_xhs_covers" || tool === "search_xhs_notes" || tool === "search_wechat_articles")) kinds.add("search");
    if (module.tools.includes("analyze_xhs_covers")) kinds.add("vision");
    if (module.tools.includes("generate_image")) kinds.add("image");
  }
  return (["search", "image", "vision"] as const).filter(kind => kinds.has(kind));
}
