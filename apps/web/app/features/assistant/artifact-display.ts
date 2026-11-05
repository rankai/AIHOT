import type { AssistantArtifact, AssistantArtifactDelivery, AssistantCoverChoiceContext, AssistantMessage, AssistantSession } from "@aihot/contracts/assistant";

export interface ArtifactTarget { artifactId: string; version: number }

/** The response Content-Type owns the extension; a title or storage key cannot prove it. */
export function imageDownloadName(title: string, version: number): string {
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 120);
  return `${name || "图片"} · 第 ${version} 版`;
}

export function coverChoiceSchemes(choice: AssistantCoverChoiceContext, artifacts: AssistantArtifact[]) {
  const plan = artifacts.find((artifact) => artifact.artifactId === choice.artifactId && artifact.version === choice.version && artifact.kind === "xhs-cover-plan")?.content.coverPlan;
  return choice.schemes.map((scheme) => {
    const detail = plan?.schemes.find((candidate) => candidate.schemeId === scheme.schemeId);
    return { ...scheme, ...(detail ? { layout: detail.layout, palette: detail.palette } : {}) };
  });
}

export function isCoverImage(artifact: AssistantArtifact) {
  const reference = artifact.content.planReference;
  return artifact.kind === "image" && !!reference?.artifactId && Number.isSafeInteger(reference.version) && reference.version > 0 && !!reference.schemeId;
}

/** A completed call in this turn owns the result; array order and older artifacts do not. */
export function currentImageTarget(session: AssistantSession): ArtifactTarget | null {
  const targets = new Map<string, ArtifactTarget>();
  for (const call of session.turn?.calls ?? []) {
    if (call.name !== "generate_image" || call.state !== "completed" || !call.result || typeof call.result !== "object") continue;
    const result = call.result as Record<string, unknown>;
    if (result.kind !== "image" || typeof result.artifactId !== "string" || !Number.isSafeInteger(result.version) || Number(result.version) < 1) continue;
    const artifact = session.artifacts.find((item) => item.artifactId === result.artifactId && item.version === result.version && item.kind === "image" && !!item.content.fileKey);
    if (artifact) targets.set(`${artifact.artifactId}:${artifact.version}`, { artifactId: artifact.artifactId, version: artifact.version });
  }
  return targets.size === 1 ? [...targets.values()][0]! : null;
}

export function artifactDisplayName(artifact: AssistantArtifact) {
  return artifact.kind === "xhs-cover-plan" ? "三套设计方案" : artifact.kind === "image" ? isCoverImage(artifact) ? "生成的封面" : "生成的图片" : artifact.kind === "xhs-note" ? "笔记" : "文章";
}

/** Older snapshots can identify images, but cannot safely associate old drafts with a turn. */
export function artifactDeliveries(session: AssistantSession): AssistantArtifactDelivery[] {
  if (session.deliveries) return session.deliveries;
  const target = currentImageTarget(session);
  const artifact = target && session.artifacts.find((item) => item.artifactId === target.artifactId);
  return artifact && session.turn ? [{ ...target!, turnId: session.turn.turnId, kind: artifact.kind, title: artifact.content.title }] : [];
}

/** One saved item may follow its new version; several items have no implicit winner. */
export function currentArtifactTarget(session: AssistantSession): ArtifactTarget | null {
  const image = currentImageTarget(session);
  if (image) return image;
  const deliveries = artifactDeliveries(session).filter((item) => item.turnId === session.turn?.turnId);
  const identities = new Set(deliveries.map((item) => item.artifactId));
  if (identities.size !== 1) return null;
  const latest = deliveries.reduce((chosen, item) => item.version > chosen.version ? item : chosen);
  // A later manual edit is not a new generated delivery to follow.
  return session.artifacts.some((item) => item.artifactId === latest.artifactId && item.version === latest.version)
    ? { artifactId: latest.artifactId, version: latest.version } : null;
}

export function indexArtifactDeliveries(messages: AssistantMessage[], deliveries: AssistantArtifactDelivery[]) {
  const turnMessages = new Map<string, AssistantMessage[]>();
  for (const message of messages) if (message.turnId) {
    const group = turnMessages.get(message.turnId);
    if (group) group.push(message);
    else turnMessages.set(message.turnId, [message]);
  }
  const afterMessage = new Map<string, AssistantArtifactDelivery[]>();
  const unanchored: AssistantArtifactDelivery[] = [];
  for (const delivery of deliveries) {
    const groupMessages = turnMessages.get(delivery.turnId) ?? [];
    let id = groupMessages.at(-1)?.id;
    // Message seq and eventSeq are separate clocks. Only compare complete, ordered
    // event evidence; older snapshots retain the existing end-of-turn placement.
    if (isEventSeq(delivery.eventSeq) && groupMessages.every((message, index) =>
      isEventSeq(message.eventSeq) && message.eventSeq !== delivery.eventSeq &&
      (!index || message.eventSeq > groupMessages[index - 1]!.eventSeq!))) {
      id = groupMessages.findLast((message) => message.eventSeq! < delivery.eventSeq!)?.id ?? id;
    }
    if (!id) { unanchored.push(delivery); continue; }
    const group = afterMessage.get(id);
    if (group) group.push(delivery);
    else afterMessage.set(id, [delivery]);
  }
  for (const group of afterMessage.values()) {
    if (group.every((delivery) => isEventSeq(delivery.eventSeq))) group.sort((a, b) => a.eventSeq! - b.eventSeq!);
  }
  return { afterMessage, unanchored };
}

function isEventSeq(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && value! > 0;
}

export function deliverySummary(deliveries: AssistantArtifactDelivery[]): string {
  if (deliveries.length !== 1) return "本次作品已保存。";
  const delivery = deliveries[0]!;
  if (delivery.kind === "image") return "图片已生成。";
  if (delivery.kind === "xhs-cover-plan") return "三套封面方案已保存。";
  return delivery.version > 1 ? `已保存第 ${delivery.version} 版。` : `《${delivery.title}》写好了。`;
}

/** The direct image action covers only that saved version, not other pending deliveries. */
export function uncoveredArtifactUpdates(updates: ArtifactTarget[], covered: ArtifactTarget | readonly ArtifactTarget[] | null) {
  const targets: readonly ArtifactTarget[] = covered ? "artifactId" in covered ? [covered] : covered : [];
  const identities = new Set(targets.map((target) => `${target.artifactId}:${target.version}`));
  return updates.filter((target) => !identities.has(`${target.artifactId}:${target.version}`));
}
