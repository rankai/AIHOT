import { videoUploadReferenceLink } from "./video-data";
import { Link } from "react-router";
import { imageUploadReferenceLink } from "./image-model-data";
import type { ImageOptions } from "./image-types";
import { operationFileAsset } from "./asset-data";
import type { OperationResult } from "./operation-types";
import { PrivateAssetView } from "./private-asset";
import { safeExternalUrl } from "./platform-types";
import { researchFactText } from "./research-platform-data";
import { ResearchFacts } from "./research-platform-result";
import { Json } from "./ui";
export function MediaUploadResult({ result: r, imageOptions }: { result: OperationResult; imageOptions: ImageOptions | null }) {
  const url = safeExternalUrl(r.data.resourceUrl), referenceLink = imageUploadReferenceLink(r, imageOptions), videoReferenceLink = videoUploadReferenceLink(r, imageOptions);
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0"><p className="text-[14px] font-medium">Redfox 素材上传回执</p>
    <ResearchFacts items={[["返回格式", researchFactText(r.data.format)]]} />
    {url ? <a className="block break-all text-[13px] text-accent" href={url} target="_blank" rel="noreferrer">查看供应商资源地址 ↗</a> : <p className="text-[12px] text-ink-3">没有可安全打开的供应商资源地址。</p>}
    <p className="text-[12px] text-ink-3">上方是供应商资源地址，下方仅预览关联的本地私有素材；不会自动读取或下载远端资源，也不创建文章。</p>
    {referenceLink && <Link className="inline-block text-[13px] text-accent" target="_blank" rel="noreferrer" to={referenceLink}>用作图片参考（复用本次上传） ↗</Link>}
    {videoReferenceLink && <Link className="inline-block text-[13px] text-accent" target="_blank" rel="noreferrer" to={videoReferenceLink}>用作视频参考（复用本次上传） ↗</Link>}
    <PrivateAssetView asset={operationFileAsset(r.file)} options={null} />
    <Json value={{ resultId: r.id, receiptId: r.receiptId, data: r.data }} label="素材上传字段与回执诊断" />
  </article>;
}
