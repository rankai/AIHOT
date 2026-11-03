import { useRef, useState } from "react";
import type { AssistantArtifact, AssistantFeeAuthorization, AssistantOptions, AssistantProfileDto, AssistantSkillSelection } from "@aihot/contracts/assistant";
import { IconApps } from "../../components/icons";
import { Button, Select } from "../admin/ui";
import { ComposerMenu } from "./composer-menu";

export function AssistantComposerControls({ profile, selection, onSelection, disabled, addFiles, capabilities, artifacts = [], onReference, feeAuthorization, configureFees, manualFees, feeDisabled = disabled, refreshOptions, taskChoice, onTaskChoice }: {
  taskChoice?: import("@aihot/contracts/assistant").AssistantTaskChoice; onTaskChoice?: (choice: import("@aihot/contracts/assistant").AssistantTaskChoice | undefined)=>void;
  profile: AssistantProfileDto; selection: AssistantSkillSelection | null; onSelection: (selection: AssistantSkillSelection | null) => void; disabled: boolean;
  addFiles: (files: File[]) => void; capabilities: AssistantOptions["inputCapabilities"];
  artifacts?: AssistantArtifact[]; onReference?: (artifact: AssistantArtifact) => void;
  feeAuthorization?: AssistantFeeAuthorization | null; configureFees: () => void; manualFees?: () => void;
  feeDisabled?: boolean; refreshOptions?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<"add" | "skill" | "fee" | null>(null);
  function changeMenu(owner: "add" | "skill" | "fee", open: boolean) {
    // A previous menu can still observe focus while the next portal is mounting.
    setOpenMenu((current) => open ? owner : current === owner ? null : current);
  }
  const [pickArtifact, setPickArtifact] = useState(false);
  const referenceableArtifacts = artifacts.filter((artifact) => artifact.kind !== "image");
  const groups = [...new Map(profile.actions.map(action => [action.skillId, { skillId: action.skillId, name: action.skillName,
    available: profile.actions.some(item => item.skillId === action.skillId && item.available) }])).values()];
  const legacy = selection && "actionId" in selection ? profile.actions.find(action => action.actionId === selection.actionId) : null;
  const selected = selection && "skillId" in selection ? groups.find(group => group.skillId === selection.skillId) : null;
  const label = legacy ? `${legacy.skillName} · 本次：${legacy.label}` : selected?.name ?? (selection ? "原技能不可用，请重新选择" : "自动选择技能");
  return <div className="assistant-composer-controls">
    <input ref={input} type="file" multiple accept={capabilities.fileTypes.join(",")} className="sr-only" tabIndex={-1} aria-label="选择 TXT 或 MD 文件，可多选" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) addFiles(files); }} />
    <ComposerMenu open={openMenu === "add"} setOpen={(open) => changeMenu("add", open)} disabled={disabled} label="添加材料" className="assistant-add-menu"
      trigger={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>}>
      <button role="menuitem" type="button" disabled={disabled} onClick={() => input.current?.click()}>上传 TXT / MD 文件</button>
      <button role="menuitem" type="button" disabled={disabled || !referenceableArtifacts.length} onClick={() => setPickArtifact(true)}>引用已保存稿件{!referenceableArtifacts.length ? "（暂无）" : ""}</button>
      <p>上传和读取文本不消耗积分。粘贴链接仅作为文字。</p>
    </ComposerMenu>
    <ComposerMenu open={openMenu === "skill"} setOpen={(open) => changeMenu("skill", open)} disabled={disabled} label={`选择技能，当前${label}`} className="assistant-skill-control" onOpen={refreshOptions}
      trigger={<><IconApps size={16} /><span>{label}</span></>}>
      {selection && !legacy && !selected && <button type="button" role="menuitemradio" aria-checked="true" disabled>原技能不可用，请重新选择</button>}
      {legacy && <button type="button" role="menuitemradio" aria-checked="true" disabled>{legacy.skillName} · 本次：{legacy.label}</button>}
      <button type="button" role="menuitemradio" aria-checked={!selection} disabled={disabled} onClick={() => onSelection(null)}>自动选择技能</button>
      {groups.map((group) => <button type="button" key={group.skillId} role="menuitemradio" aria-checked={selected?.skillId === group.skillId} disabled={disabled || !group.available} onClick={() => onSelection({ skillId: group.skillId })}>{group.name}{!group.available ? " · 暂不可用" : ""}</button>)}
    </ComposerMenu>
    <span className="text-[11px] text-ink-3" title="每次任务确认一次上限，完成或停止后按实际交付结算">执行前确认费用</span>
    {pickArtifact && <ArtifactPicker artifacts={referenceableArtifacts} close={() => setPickArtifact(false)} select={(artifact) => { onReference?.(artifact); setPickArtifact(false); }} />}
  </div>;
}
function ArtifactPicker({ artifacts, close, select }: { artifacts: AssistantArtifact[]; close: () => void; select: (artifact: AssistantArtifact) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [id, setId] = useState(artifacts[0]?.artifactId ?? "");
  // The existing artifact panel remains the version selector; this chooser references saved current versions.
  return <dialog ref={(node) => { dialog.current = node; if (node && !node.open) node.showModal(); }} className="assistant-dialog" aria-labelledby="assistant-material-picker-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <h2 id="assistant-material-picker-title" className="text-[18px] font-semibold">引用已保存稿件</h2>
    <p className="my-3 text-[12px] text-ink-3">选择当前已保存版本；其他版本可从右侧稿件面板“用这版继续修改”引用。</p>
    <Select value={id} aria-label="选择要引用的稿件" onChange={(event) => setId(event.target.value)}>{artifacts.map((artifact) => <option key={artifact.artifactId} value={artifact.artifactId}>{artifact.content.title} · v{artifact.version}</option>)}</Select>
    <div className="mt-5 flex justify-end gap-2"><Button onClick={close}>取消</Button><Button tone="primary" disabled={!id} onClick={() => { const artifact = artifacts.find((row) => row.artifactId === id); if (artifact) select(artifact); }}>引用这版</Button></div>
  </dialog>;
}

export function AssistantSkillNotice() {
  return <p role="status" className="assistant-skill-notice">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>
    <span>内容已保留。当前技能暂不可用，可稍后再试或更换技能。</span>
  </p>;
}

export function TaskClarification({profile,selection,disabled,confirm}:{profile:AssistantProfileDto;selection:AssistantSkillSelection|null;disabled:boolean;confirm:(choice:import("@aihot/contracts/assistant").AssistantTaskChoice)=>void}) {
 const options=(profile.taskOptions??[]).filter(o=>!selection||('skillId' in selection?o.choice.skillId===selection.skillId:profile.actions.find(a=>a.actionId===selection.actionId)?.skillId===o.choice.skillId));
 const [index,setIndex]=useState<number|null>(null),[size,setSize]=useState('');
 const current=index===null?null:options[index];
 return <section className="assistant-inline-notice" aria-label="确认本次交付内容"><p className="mb-2 text-[13px]">这次希望完成什么？</p><div className="space-y-2">{options.map((option,i)=><label key={JSON.stringify(option.choice)} className="flex items-start gap-2 text-[12px]"><input type="radio" name="assistant-task-choice" checked={index===i} disabled={disabled} onChange={()=>{setIndex(i);setSize(option.sizes[0]??'');}}/><span>{option.label}</span></label>)}</div>{current?.sizes.length ? <label className="mt-3 flex items-center gap-2 text-[12px]">图片比例<select className="rounded border border-line bg-surface px-2 py-1" aria-label="图片比例" value={size} disabled={disabled} onChange={e=>setSize(e.target.value)}>{current.sizes.map(s=><option key={s}>{s}</option>)}</select></label>:null}<Button className="mt-3" size="sm" disabled={disabled||!current} onClick={()=>current&&confirm({...current.choice,...(current.sizes.length?{size}:{})})}>继续获取费用</Button></section>;
}
