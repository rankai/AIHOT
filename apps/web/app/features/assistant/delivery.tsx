import type { AssistantArtifactDelivery } from "@aihot/contracts/assistant";
import { IconChevronRight, IconDoc, IconImage, IconLayers } from "../../components/icons";
import { deliverySummary, type ArtifactTarget } from "./artifact-display";
import { ImageDownload } from "./image-download";

export function AssistantDelivery({ sessionId, deliveries, hasReply = false, imageFiles, showArtifacts }: {
  sessionId: string;
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
      <span className="assistant-delivery-icon" data-kind={delivery.kind} aria-hidden="true">{delivery.kind === "image" ? <IconImage size={22} /> : delivery.kind === "xhs-cover-plan" ? <IconLayers size={22} /> : <IconDoc size={22} />}</span>
      <span className="assistant-delivery-file"><span className="assistant-delivery-title">{delivery.title}</span><span className="assistant-delivery-meta">{delivery.kind === "image" ? "图片" : delivery.kind === "xhs-cover-plan" ? "封面方案" : delivery.kind === "xhs-note" ? "小红书笔记" : "文章草稿"}<span className="assistant-delivery-version"> · 第 {delivery.version} 版</span></span></span>
      <IconChevronRight size={16} />
    </button>{delivery.kind === "image" && <ImageDownload compact sessionId={sessionId} artifactId={delivery.artifactId} version={delivery.version} title={delivery.title} fileKey={imageFiles?.get(`${delivery.artifactId}:${delivery.version}`)} />}</div>)}
  </div>;
}
