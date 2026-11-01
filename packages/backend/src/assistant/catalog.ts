import { readFile, realpath, lstat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sha256, stableJson } from "../lib/ids.ts";
import { AccountError } from "../users/accounts.ts";
import type { AssistantId, AssistantTaskHint } from "@aihot/contracts/assistant";
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
    inputSchema: z.literal("writing-input@1"),
    toolContractVersion: z.literal(1),
    outputSchemaVersion: z.literal(1),
    deliveryContract: z.literal("writing-delivery@1"),
    entryResource: Id,
    resources: z.array(Id),
    tools: z.array(z.enum(["save_draft", "search_xhs_notes", "analyze_xhs_research"])),
    outputKinds: z.array(z.enum(["text-draft", "xhs-note"])),
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
        license: z.literal("NOASSERTION"), usageBasis: z.literal("user-directed-local-evaluation"),
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
    ["general-writing", "xiaohongshu-creator", "xiaohongshu-creator-v2"].map(async (id) =>
      validatePackage(resolve(root, id), JSON.parse(await readFile(resolve(root, id, "manifest.json"), "utf8"))),
    ),
  ));
}
export const profiles = {
  creative: {
    id: "creative",
    version: "1",
    name: "创作助手",
    welcome: "提供材料，起草、列提纲或改写；也可选择小红书创作。",
    skills: ["general-writing", "xiaohongshu-creator"],
    modules: { "general-writing": ["write"], "xiaohongshu-creator": ["M1", "M2"] },
    tools: ["save_draft", "search_xhs_notes", "analyze_xhs_research"],
  },
  xiaohongshu: {
    id: "xiaohongshu",
    version: "1",
    name: "小红书助手",
    welcome: "根据你的材料写笔记或改写原稿。创作先检索真实笔记并分析规律；改写使用原稿。",
    skills: ["xiaohongshu-creator"],
    modules: { "xiaohongshu-creator": ["M1", "M2"] },
    tools: ["save_draft", "search_xhs_notes", "analyze_xhs_research"],
  },
} as const;
export function profile(id: unknown) {
  const key = z.enum(["creative", "xiaohongshu"]).parse(id);
  return profiles[key];
}
export function taskHint(id: AssistantId, raw: unknown): AssistantTaskHint | null {
  if (raw === null || raw === undefined) return null;
  const hint = z
    .object({ actionId: z.enum(["general-writing", "xiaohongshu-write", "xiaohongshu-rewrite"]) })
    .strict()
    .parse(raw);
  if (id === "xiaohongshu" && hint.actionId === "general-writing")
    throw catalogError("scope_denied", "当前助手不支持此动作");
  return hint;
}
export async function candidates(id: AssistantId, selection?: AssistantTaskHint | null): Promise<Candidate[]> {
  const p = profile(id);
  const selected = taskHint(id, selection);
  const bindings: Record<string, [string, string]> = { "general-writing": ["general-writing", "write"], "xiaohongshu-write": ["xiaohongshu-creator", "M1"], "xiaohongshu-rewrite": ["xiaohongshu-creator", "M2"] };
  return (await catalog())
    .filter((s) => (p.skills as readonly string[]).includes(s.manifest.skillId))
    .filter((s) => s.manifest.skillId !== "xiaohongshu-creator" || s.manifest.version === "3")
    .flatMap(({ manifest: s }) =>
      s.modules
        .filter((m) => ((p.modules as Record<string, readonly string[]>)[s.skillId] ?? []).includes(m.moduleId))
        .filter((m) => !selected || (bindings[selected.actionId]![0] === s.skillId && bindings[selected.actionId]![1] === m.moduleId))
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
