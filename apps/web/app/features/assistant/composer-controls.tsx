import { useRef, useState } from "react";
import type { AssistantArtifact, AssistantFeeAuthorization, AssistantOptions, AssistantProfileDto } from "@aihot/contracts/assistant";
import { IconApps } from "../../components/icons";
import { Button, Select } from "../admin/ui";

export function AssistantComposerControls({ profile, actionId, onAction, disabled, addFiles, capabilities, artifacts = [], onReference, feeAuthorization, configureFees, manualFees, feeDisabled = disabled }: {
  profile: AssistantProfileDto; actionId: string | null; onAction: (id: string | null) => void; disabled: boolean;
  addFiles: (files: File[]) => void; capabilities: AssistantOptions["inputCapabilities"];
  artifacts?: AssistantArtifact[]; onReference?: (artifact: AssistantArtifact) => void;
  feeAuthorization?: AssistantFeeAuthorization | null; configureFees: () => void; manualFees?: () => void;
  feeDisabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const feeMenu = useRef<HTMLDetailsElement>(null);
  const [pickArtifact, setPickArtifact] = useState(false);
  const label = profile.actions.find((action) => action.actionId === actionId)?.label ?? "自动选择技能";
  return <div className="assistant-composer-controls">
    <input ref={input} type="file" multiple accept={capabilities.fileTypes.join(",")} className="sr-only" tabIndex={-1} aria-label="选择 TXT 或 MD 文件，可多选" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) addFiles(files); }} />
    <details className="assistant-add-menu" ref={menu}>
      <summary aria-label="添加材料" title="添加材料" aria-disabled={disabled} onClick={(event) => { if (disabled) event.preventDefault(); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></summary>
      <div>
        <button type="button" disabled={disabled} onClick={() => { menu.current?.removeAttribute("open"); input.current?.click(); }}>上传 TXT / MD 文件</button>
        <button type="button" disabled={disabled || !artifacts.length} onClick={() => { menu.current?.removeAttribute("open"); setPickArtifact(true); }}>引用已保存稿件{!artifacts.length ? "（暂无）" : ""}</button>
        <p>上传和读取文本不消耗积分。粘贴链接仅作为文字。</p>
      </div>
    </details>
    <label className="assistant-skill-control" title={label}>
      <span className="sr-only">选择技能，当前{label}</span>
      <IconApps size={16} />
      <select value={actionId ?? ""} disabled={disabled} aria-label={`选择技能，当前${label}`} onChange={(event) => onAction(event.target.value || null)}>
        <option value="">自动选择技能</option>
        {profile.actions.map((action) => <option key={action.actionId} value={action.actionId} disabled={!action.available}>{action.label}{!action.available ? " · 未开放" : ""}</option>)}
      </select>
    </label>
    <details className="assistant-fee-menu" ref={feeMenu}>
    <summary className="assistant-fee-control" aria-disabled={feeDisabled} onClick={(event) => { if (feeDisabled) event.preventDefault(); }} aria-label={`费用确认：${feeAuthorization?.enabled ? `额度内自动，剩余${feeAuthorization.remaining}积分` : "每次确认"}`}>
      <span><span className="assistant-control-long">{feeAuthorization?.enabled ? "额度内自动" : "每次确认"}</span><span className="assistant-control-short">{feeAuthorization?.enabled ? "自动" : "费用确认"}</span><span aria-hidden="true"> ▾</span></span>
      {feeAuthorization?.enabled && <span className="assistant-fee-remaining">剩余 {feeAuthorization.remaining} 积分</span>}
    </summary>
      <div className="assistant-fee-menu-options">
        <button type="button" disabled={feeDisabled} aria-pressed={!feeAuthorization?.enabled} onClick={() => { feeMenu.current?.removeAttribute("open"); manualFees?.(); }}>每次确认</button>
        <button type="button" disabled={feeDisabled} aria-pressed={!!feeAuthorization?.enabled} onClick={() => { feeMenu.current?.removeAttribute("open"); configureFees(); }}>额度内自动</button>

      </div>
    </details>
    {pickArtifact && <ArtifactPicker artifacts={artifacts} close={() => setPickArtifact(false)} select={(artifact) => { onReference?.(artifact); setPickArtifact(false); }} />}
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
