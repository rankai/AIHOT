import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AssistantId } from "@aihot/contracts/assistant";
/** Executable capabilities are implemented in code; binding data never contains a handler or expression. */
export const capabilities = {
  "generate_image@1": "generate_image",
  "save-xhs-cover-plan@1": "save_xhs_cover_plan",
  "save-writing@1": "save_draft",
  "analyze-xhs-cover-images@1": "analyze_xhs_covers",
  "search-xhs-covers@1": "search_xhs_covers",
  "search-xhs-notes@1": "search_xhs_notes",
  "analyze-xhs-research@1": "analyze_xhs_research",
  "search-wechat-hot@1": "search_wechat_articles",
  "analyze-wechat-research@1": "analyze_wechat_research",
} as const;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const capability = z.enum(Object.keys(capabilities) as [keyof typeof capabilities, ...(keyof typeof capabilities)[]]);
export type Capability = keyof typeof capabilities;
export const Binding = z.object({ formatVersion: z.literal(1), skillId: id, version: z.string().regex(/^\d+$/), name: z.string().max(80),
  modules: z.array(z.object({ moduleId: id, profiles: z.array(z.enum(["creative", "xiaohongshu"])).min(1), actionId: id,
    label: z.string().max(80), entry: id, capabilities: z.array(capability).min(1), inputContract: z.enum(["writing-input@1", "image-input@1"]),
    deliveryContract: z.enum(["writing-delivery@1", "wechat-research-writing@1", "image-delivery@1", "xhs-cover-delivery@1"]), references: z.array(id),
    tasks: z.array(z.object({
      delivery: z.enum(["writing", "plans-only", "image"]), label: z.string().min(1).max(120),
      units: z.array(z.object({ capability: z.enum(["creation", "search-xhs-covers@1", "search-xhs-notes@1", "search-wechat-hot@1", "analyze-xhs-cover-images@1", "generate_image@1"]), maximum: z.number().int().min(1).max(2) }).strict()).min(1).max(5),
    }).strict()).min(1).max(3).optional(),
    scriptBindings: z.array(z.object({ path: z.string().regex(/^upstream\/scripts\/[a-zA-Z0-9_-]+\.py$/), capability }).strict()),
  }).strict()).min(1),
 }).strict().superRefine((binding,ctx)=>{
  for(const [index,module] of binding.modules.entries()){
    if(!module.tasks)continue;
    const seen=new Set<string>();
    for(const task of module.tasks){
      const units=new Map(task.units.map(unit=>[unit.capability,unit.maximum]));
      const paid=module.capabilities.filter(c=>['search-xhs-covers@1','search-xhs-notes@1','search-wechat-hot@1','analyze-xhs-cover-images@1'].includes(c));
      if(seen.has(task.delivery)||units.size!==task.units.length||units.get('creation')!==1||
        task.units.some(u=>u.capability!=='creation'&&!module.capabilities.includes(u.capability))||
        paid.some(c=>!units.has(c as never))||
        (task.delivery==='plans-only'&&module.deliveryContract!=='xhs-cover-delivery@1')||
        (task.delivery==='writing'&&!module.capabilities.includes('save-writing@1'))||
        (task.delivery==='image'?units.get('generate_image@1')!==1:units.has('generate_image@1')))
        ctx.addIssue({code:'custom',path:['modules',index,'tasks'],message:'Task fees must match implemented bounded capability and delivery contracts'});
      seen.add(task.delivery);
    }
  }
});
const Registry = z.object({
  formatVersion: z.literal(1),
  entries: z.array(z.object({ directory: id, currentVersion: z.string().regex(/^\d+$/).optional() }).strict()).min(1),
}).strict();
/** Fixed package configuration, including immutable historical packages. No uploads or dynamic discovery. */
export const registry = Registry.parse(JSON.parse(readFileSync(new URL("./skills/registry.json", import.meta.url), "utf8")));
if (new Set(registry.entries.map(entry => entry.directory)).size !== registry.entries.length) throw new Error("Duplicate skill directory");
export const bindings = registry.entries.map(entry => ({
  directory: entry.directory, ...Binding.parse(JSON.parse(readFileSync(new URL(`./skills/${entry.directory}/binding.json`, import.meta.url), "utf8"))),
}));
const currentEntries = registry.entries.flatMap(entry => {
  const binding = bindings.find(item => item.directory === entry.directory)!;
  if (entry.currentVersion && entry.currentVersion !== binding.version) throw new Error("Current skill version does not match binding");
  return entry.currentVersion ? [{ skillId: binding.skillId, version: entry.currentVersion }] : [];
});
if (new Set(currentEntries.map(entry => entry.skillId)).size !== currentEntries.length) throw new Error("Duplicate current skill");
export const currentSkillVersions: Record<string, string> = Object.fromEntries(currentEntries.map(entry => [entry.skillId, entry.version]));
const current = bindings.filter(b => b.version === currentSkillVersions[b.skillId]);
export const skillNames = Object.fromEntries(current.map(b => [b.skillId, b.name]));
export const actions = current.flatMap(b => b.modules.map(m => ({ actionId: m.actionId, label: m.label, skillId: b.skillId, moduleId: m.moduleId, profiles: m.profiles })));
if (new Set(actions.map(a => a.actionId)).size !== actions.length) throw new Error("Duplicate skill action");
export function bindingScope(id: AssistantId) {
  const available = current.flatMap(b => b.modules.filter(m => m.profiles.includes(id)).map(m => ({ b, m })));
  return { skills: [...new Set(available.map(({b}) => b.skillId))],
    modules: Object.fromEntries(current.map(b => [b.skillId, b.modules.filter(m => m.profiles.includes(id)).map(m => m.moduleId)])),
    tools: [...new Set(available.flatMap(({m}) => m.capabilities.map(c => capabilities[c])))],
  };
}
