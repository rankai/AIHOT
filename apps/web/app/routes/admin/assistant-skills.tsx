import { SITE } from "@aihot/industry/site";
import { useState } from "react";
import { Link } from "react-router";
import type { AssistantSkillAdminRow } from "@aihot/contracts/assistant";
import type { Route } from "./+types/assistant-skills";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, Card, DataTable, ReasonDialog, Time } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<{ skills: AssistantSkillAdminRow[] }>(request, "/api/admin/assistant-skills");
}
export const meta: Route.MetaFunction = () => [{ title: `助手技能 · ${SITE.name} 后台` }];

function canEnable(skill: AssistantSkillAdminRow) {
  return skill.policyValid && !skill.acceptingNew;
}
function SkillToggle({ skill, onSelect }: { skill: AssistantSkillAdminRow; onSelect: (skill: AssistantSkillAdminRow) => void }) {
  const invalid = !skill.policyValid;
  const next = canEnable(skill);
  return <Button size="sm" tone={next ? "primary" : "danger"} onClick={() => onSelect(skill)}>{invalid ? "修复为暂停" : next ? "允许新任务" : "暂停新任务"}</Button>;
}
function Status({ skill }: { skill: AssistantSkillAdminRow }) {
  return <div className="space-y-2">
    <Badge tone={skill.acceptingNew ? "ok" : "muted"}>{skill.acceptingNew ? "允许新任务" : "暂停新任务"}</Badge>
    <p className="text-[12px] text-ink-3">{skill.available ? skill.reasons.length ? "部分模块暂不可用" : "当前可用" : "当前不可用"}</p>
    {!!skill.reasons.length && <ul className="space-y-1 text-[12px] text-ink-3">{skill.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
  </div>;
}
function Details({ skill }: { skill: AssistantSkillAdminRow }) {
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-[12px]">
      {skill.modules.map(module => <Link key={module.id} className="text-accent" to={`/admin/costs?${new URLSearchParams({ skillId: skill.skillId, moduleId: module.id })}`}>{module.name}成本</Link>)}
      <Link className="text-accent" to={`/admin/audit?${new URLSearchParams({ action: "assistant.skill.", subject: `assistant-skill:${skill.skillId}` })}`}>审计记录</Link>
    </div>
    <details className="text-[12px] text-ink-3"><summary className="cursor-pointer">技术信息</summary>
      <dl className="mt-2 space-y-2 break-all">
        <div><dt>skillId</dt><dd className="font-mono">{skill.skillId}</dd></div>
        <div><dt>来源</dt><dd>{skill.source ? JSON.stringify(skill.source) : "技能包不可用"}</dd></div>
        <div><dt>包 hash</dt><dd className="font-mono">{skill.packageHash ?? "不可用"}</dd></div>
        <div><dt>依赖</dt><dd>{skill.dependencies.join("；")}</dd></div>
        <div><dt>支持能力</dt><dd>{skill.capabilities.join("；") || "技能包不可用"}</dd></div>
        <div><dt>开放输入与交付范围</dt><dd>{skill.openScope.join("；") || "技能包不可用"}</dd></div>
        <div><dt>上游脚本</dt><dd>仅归档，不会执行；所需接口由平台受控能力接管。</dd></div>
      </dl>
    </details>
  </div>;
}
function Modified({ skill }: { skill: AssistantSkillAdminRow }) {
  return <div className="space-y-1 text-[12px] text-ink-3"><p>{skill.updatedBy ?? "尚未配置"}</p><Time at={skill.updatedAt} /></div>;
}
export default function AssistantSkills({ loaderData }: Route.ComponentProps) {
  const [selectedSkill, setSelectedSkill] = useState<AssistantSkillAdminRow | null>(null);
  const { run, pending } = useAdminAction();
  const next = selectedSkill ? canEnable(selectedSkill) : false;
  const repair = !!selectedSkill && !selectedSkill.policyValid;
  return <AdminPage title="助手技能" subtitle="统一控制综合助手与专属入口的新创作。暂停后，已受理任务继续，历史稿件和成本记录保留。">
    <div className="hidden md:block"><Card pad={false}><DataTable rows={loaderData.skills} rowKey={s => s.skillId} columns={[
      { key: "skill", label: "技能 / 开放模块", render: s => <div className="min-w-40 space-y-2"><p className="font-medium text-ink">{s.name} <span className="font-mono text-[12px] text-ink-3">v{s.version}</span></p><p className="text-[12px] text-ink-3">{s.modules.map(m => m.name).join("、")}</p><Details skill={s} /></div> },
      { key: "state", label: "状态", render: s => <Status skill={s} /> },
      { key: "modified", label: "最近修改", render: s => <Modified skill={s} /> },
      { key: "action", label: "操作", render: s => <SkillToggle skill={s} onSelect={setSelectedSkill} /> },
    ]} /></Card></div>
    <div className="space-y-4 md:hidden">{loaderData.skills.map(skill => <Card key={skill.skillId}>
      <div className="space-y-4"><div><h2 className="font-medium">{skill.name} · v{skill.version}</h2><p className="mt-1 text-[12px] text-ink-3">{skill.modules.map(m => m.name).join("、")}</p></div>
        <Status skill={skill} /><SkillToggle skill={skill} onSelect={setSelectedSkill} /><Modified skill={skill} /><Details skill={skill} />
      </div>
    </Card>)}</div>
    {selectedSkill && <ReasonDialog open title={`${repair ? "修复技能配置" : next ? "允许新任务" : "暂停新任务"}：${selectedSkill.name}`}
      description={repair ? "当前运营配置无法解析。保存后会恢复为明确的暂停状态，不会删除历史任务、稿件、计费或成本记录；修正后再单独允许新任务。" : next ? "开启前会检查技能包、已开放模块、模型、预算和价目。保存操作不调用模型或数据服务。" : "暂停后，用户不能发起新的创作；已开始的任务继续完成。"}
      danger={!next} confirmLabel={repair ? "修复为暂停" : next ? "允许新任务" : "暂停新任务"} busy={!!pending} onClose={() => setSelectedSkill(null)}
      onSubmit={async reason => (await run("PUT", `/api/admin/assistant-skills/${encodeURIComponent(selectedSkill.skillId)}`, { acceptingNew: next, expectedRevision: selectedSkill.revision, reason }, { label: "skill", success: repair ? "已修复为暂停" : next ? "已允许新任务" : "已暂停新任务" })) !== null} />}
  </AdminPage>;
}
