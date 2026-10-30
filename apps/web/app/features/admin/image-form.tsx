import { ToolSubmit } from '../tools/tool-submit';
import type { AssetUploadOptions } from "./asset-types";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useAdminAction } from "./action";
import { ImageReferences } from "./image-references";
import { ImageModelFields } from "./image-model-fields";
import { imageGenerationBody, imageGenerationModels, imageModelDraft, imageModelOption, imageQueryBody, imageReferenceReuseId, selectedImageUploads } from "./image-model-data";
import { referenceIssue, type AssetPage, type ImageDraft, type ImageModel, type ImageOptions, type PrivateAsset } from "./image-types";
import type { OperationAccepted } from "./operation-types";
import { Button, Card, Field, Input, Select, Textarea } from "./ui";
export function ImageForm({ options, assets, reference, referenceError, initialTaskId, uploadOptions, assetUpdates, onAssetChange, initialModel = "gptImage2", initialReferenceUploadResult = "" }: { initialModel?: string; initialReferenceUploadResult?: string; uploadOptions: AssetUploadOptions; assetUpdates: PrivateAsset[]; onAssetChange: (asset: PrivateAsset) => void; options: ImageOptions; assets: AssetPage; reference: PrivateAsset | null; referenceError: string | null; initialTaskId: string }) {
  const navigate = useNavigate(), { run, pending } = useAdminAction();
  const startingModel = imageModelOption(options, initialModel)?.model ?? "gptImage2";
  const initialIssue = reference ? referenceIssue(reference, options) : null;
  const reuseId = imageReferenceReuseId(initialReferenceUploadResult);
  const reuseIssue = initialReferenceUploadResult && (!reuseId || startingModel === "gptImage2") ? "此上传复用记录或目标模型无效，未自动选择参考；请从上传结果重新打开。" : null;
  const [model, setModel] = useState<ImageModel>(startingModel), [queryModel, setQueryModel] = useState<ImageModel>(startingModel);
  const [drafts, setDrafts] = useState<Record<string, ImageDraft>>(() => Object.fromEntries(options.models.map(option => {
    const draft = imageModelDraft(option, options);
    if (option.model === startingModel && reference && !initialIssue && !reuseIssue) { draft.selected = [reference]; if (reuseId) draft.referenceUploads = [{ fileKey: reference.key, resultId: reuseId }]; }
    return [option.model, draft];
  })));
  const [taskIds, setTaskIds] = useState<Partial<Record<ImageModel, string>>>({ [startingModel]: initialTaskId });
  const [notice, setNotice] = useState<string | null>(referenceError ?? initialIssue ?? reuseIssue), [uploading, setUploading] = useState(false);
  const option = imageModelOption(options, model)!, draft = drafts[model]!;
  const generationUnavailable = option.generationAvailable === false;
  const currentSelected = draft.selected.map(asset => assetUpdates.find(update => update.key === asset.key) ?? asset).filter(asset => !referenceIssue(asset, options));
  const currentDraft = { ...draft, selected: currentSelected }, reuse = selectedImageUploads(model, currentSelected, draft.referenceUploads);
  const currentOptions = { ...options, maxReferences: option.maxReferences };
  const taskId = taskIds[queryModel] ?? "", disabled = !!pending || uploading;
  const change = (patch: Partial<ImageDraft>) => setDrafts(previous => ({ ...previous, [model]: { ...previous[model]!, ...patch } }));
  const select = (asset: PrivateAsset) => {
    const issue = referenceIssue(asset, options); if (issue) { setNotice(issue); return; }
    if (currentSelected.some(row => row.key === asset.key) || currentSelected.length >= option.maxReferences) return;
    change({ selected: [...currentSelected, asset] }); setNotice(null);
  };
  return <div className="space-y-5">
    <Card title="图片创作" right={<span>{option.label}</span>}>
      <form aria-label="图片创作表单" className="space-y-4" onSubmit={async e => {
        e.preventDefault(); if (disabled) return;
        let body: Record<string, unknown>;
        try { body = imageGenerationBody(model, currentDraft, options); setNotice(null); } catch (error) { setNotice((error as Error).message); return; }
        const result = await run<OperationAccepted>("POST", "/api/admin/redfox/images", body, { label: "image", revalidate: false });
        if (result) navigate(`/admin/operations/${result.runId}`);
      }}>
        <Field label="图片模型" hint="模型名称按 Redfox 文档展示；各模型独立保留草稿与参考。"><Select aria-label="图片模型" value={model} disabled={disabled} onChange={e => { setModel(e.target.value as ImageModel); setNotice(null); }}>{generationUnavailable && <option value={model} disabled>{option.label}（已停止新生成，请重新选择）</option>}{imageGenerationModels(options).map(row => <option key={row.model} value={row.model}>{row.label}</option>)}</Select></Field>
        {generationUnavailable && <p role="status" className="rounded-control bg-amber/10 p-3 text-[13px] text-amber">Seedream 5.0 Lite 已停止新生成，请重新选择图片模型；已有草稿未切换模型，下方仍可查询已有任务。</p>}
        <Field label="图片描述" hint={model === "gptImage2" ? "最多 10000 字符；此模型移除描述首尾空白。图片不会自动用于新闻。" : "最多 10000 字符；描述原串提交。图片不会自动用于新闻。"}><Textarea aria-label="图片描述" required rows={5} maxLength={10000} disabled={disabled} value={draft.prompt} onChange={e => change({ prompt: e.target.value })} placeholder="描述你希望生成的画面" /></Field>
        <ImageModelFields option={option} options={options} draft={draft} change={change} disabled={disabled} />
        {draft.selected.length !== currentSelected.length && <p role="status" className="text-[12.5px] text-amber">有参考素材已不可用，已排除本次提交，请重新选择。</p>}
        {notice && <p role="status" className="rounded-control bg-amber/10 p-3 text-[13px] text-amber">{notice}</p>}
        {reuse.length > 0 && <p className="rounded-control bg-bg-sunk p-3 text-[12.5px] text-ink-3">复用这次已确认上传（结果 #{reuse.map(row => row.resultId).join("、#")}），远端地址仍可能过期；失败不会自动补传。移除该参考将同时移除复用关系。</p>}
        <ImageReferences uploadOptions={uploadOptions} updates={assetUpdates} onAssetChange={onAssetChange} options={currentOptions} initialPage={assets} selected={currentSelected} onSelect={select} onRemove={key => change({ selected: draft.selected.filter(asset => asset.key !== key), referenceUploads: draft.referenceUploads.filter(row => row.fileKey !== key) })} disabled={!!pending} onUploadingChange={setUploading} />
        <div className="space-y-1 rounded-control bg-bg-sunk p-3 text-[12.5px] leading-relaxed text-ink-3"><p>本次最多上传 {currentSelected.length - reuse.length} 张未确认参考到供应商、提交生成 1 次，最多查询 {options.pollLimit} 轮（异常重试另计次数预算），最长 {options.pollDeadlineSeconds / 3600} 小时。{model === "gptImage2" ? "已有旧版供应商引用可能复用。" : "普通本地参考将在提交生成后通过通用上传传给供应商；不会自动寻找历史上传。"}</p><p>{option.documentedBaseCny === undefined ? "生成费用估算未知，以 Redfox 账单为准。" : `公开文档基价 ${option.documentedBaseCny} 元；计量方式和实际实扣未核实，不是整轮或按张报价，不按分辨率或张数推算总价。`}文档免费的上传与查询仍占 media / poll 次数预算，生成使用 image 预算。</p><p>提交、查询及仍需远端下载的保存步骤受模型与 Redfox 两个外发开关控制；已收完整本地文件可继续保存。{model !== "gptImage2" ? `参考最多 ${option.maxReferences} 张为本地边界，输出最多 ${option.maxOutputImages ?? option.maxImages} 张为本地处理边界，均不保证上游返回量。` : ""}</p></div>
        <div className="flex flex-wrap items-center justify-between gap-3"><details className="text-[12px] text-ink-4"><summary className="cursor-pointer">接口验证说明</summary><p className="mt-2 max-w-lg">{options.uploadTransportVerified ? "参考上传接口已完成相应验证。" : "供应商参考上传协议尚未完成真实联调，当前可用性仍需后台验收；不会因此自动切换供应商。"}</p></details><ToolSubmit selection={{kind:"images",model,input:{prompt:currentDraft.prompt.trim(),resolution:currentDraft.resolution,size:currentDraft.size,n:currentDraft.n,fileKeys:currentSelected.map(asset=>asset.key)}}} type="submit" tone="primary" disabled={disabled || generationUnavailable || !draft.prompt.trim()} busy={pending === "image"}>提交图片</ToolSubmit></div>
      </form>
    </Card>
    <Card title="查询已有图片任务"><form aria-label="已有图片任务查询" className="space-y-3" onSubmit={async e => {
      e.preventDefault(); if (disabled) return;
      let body: ReturnType<typeof imageQueryBody>;
      try { body = imageQueryBody(queryModel, taskId, options); setNotice(null); } catch (error) { setNotice((error as Error).message); return; }
      const result = await run<OperationAccepted>("POST", "/api/admin/redfox/images/query", body, { label: "image-query", revalidate: false });
      if (result) navigate(`/admin/operations/${result.runId}`);
    }}>
      <Field label="已有任务模型"><Select aria-label="已有图片任务模型" value={queryModel} disabled={disabled} onChange={e => setQueryModel(e.target.value as ImageModel)}>{options.models.map(row => <option key={row.model} value={row.model}>{row.label}</option>)}</Select></Field>
      <Field label="供应商任务 ID" hint="已有任务只查询并保存结果，不重新提交生成；原始 ID 保留，最多 500 字符。"><Input aria-label="供应商任务 ID" required maxLength={500} disabled={disabled} value={taskId} onChange={e => { const value = e.target.value; setTaskIds(previous => ({ ...previous, [queryModel]: value })); }} /></Field>
      <p className="text-[12.5px] text-ink-3">最多查询 {options.pollLimit} 轮，免费轮询仍计入 poll 次数预算；远端图片保存仍需两个外发开关开启。</p><ToolSubmit selection={{kind:"images/query"}} type="submit" disabled={disabled || !taskId.trim()} busy={pending === "image-query"}>提交查询</ToolSubmit>
    </form></Card>
  </div>;
}
