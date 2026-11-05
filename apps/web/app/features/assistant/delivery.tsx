import type { AssistantArtifactDelivery } from "@aihot/contracts/assistant";
import { IconChevronRight, IconDownload } from "../../components/icons";
import { deliverySummary, imageDownloadName, type ArtifactTarget } from "./artifact-display";

export function AssistantDelivery({ deliveries, hasReply = false, imageFiles, showArtifacts }: {
  deliveries: AssistantArtifactDelivery[];
  hasReply?: boolean;
  imageFiles?: ReadonlyMap<string, string>;
  showArtifacts: (target: ArtifactTarget) => void;
}) {
  if (!deliveries.length) return null;
  return <div className="assistant-delivery">
    {!hasReply && <p className="text-[14px] leading-relaxed text-ink-2">{deliverySummary(deliveries)}</p>}
    {deliveries.map((delivery) => <div className="assistant-delivery-row" key={`${delivery.artifactId}:${delivery.version}`}><button type="button" className="assistant-delivery-item" data-delivery-artifact-id={delivery.artifactId} data-delivery-version={delivery.version}
      onClick={() => showArtifacts({ artifactId: delivery.artifactId, version: delivery.version })}>
      <span className="assistant-delivery-kind">{delivery.kind === "image" ? "图片" : delivery.kind === "xhs-cover-plan" ? "方案" : delivery.kind === "xhs-note" ? "笔记" : "文章"}</span>
      <span className="assistant-delivery-title">{delivery.title}<span className="assistant-delivery-version"> · 第 {delivery.version} 版</span></span>
      <IconChevronRight size={16} />
    </button>{delivery.kind === "image" && imageFiles?.get(`${delivery.artifactId}:${delivery.version}`) && <a className="assistant-delivery-download" href={`/api/tools/assets/${encodeURIComponent(imageFiles.get(`${delivery.artifactId}:${delivery.version}`)!)}/content`} download={imageDownloadName(delivery.title, delivery.version)} title="下载图片" aria-label={`下载图片：${delivery.title} · 第 ${delivery.version} 版`}><IconDownload size={18} /></a>}</div>)}
  </div>;
}
