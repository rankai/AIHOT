import type { Tx } from "../db.ts";

// Only stable, documented IDs; adapters must supply evidence of the relationship.
const kinds: Record<string, readonly string[]> = {
  baijiahao: ["uk", "uid", "secUid"],
  dongchedi: ["userId", "authorId"], yiche: ["userId", "authorId"],
  qichezhijia: ["original_authorId", "chejiahao_authorId", "club_authorId"], zhihu: ["uid"],
  toutiao: ["uid", "secUid"], instagram: ["userId"], youtube: ["channelId"], bilibili: ["mid"], xiaohongshu: ["userId"], douyin: ["uid", "secUserId"], x: ["user_id"], weibo: ["uid"], wechat: ["wxId", "bizInfo"], tiktok: ["userId", "secUserId"],
};
export async function bindSourceAccount(tx: Tx, input: {
  platform: string; idKind: string; idValue: string; sourceId: string;
  evidence: { kind: "receipt" | "result" | "audit"; reference: string };
}): Promise<void> {
  if (!kinds[input.platform]?.includes(input.idKind) || !input.idValue || !input.evidence.reference) throw new Error("Unconfirmed account identity");
  await tx`INSERT INTO source_account_bindings(platform, id_kind, id_value, source_id, evidence)
    VALUES (${input.platform}, ${input.idKind}, ${input.idValue}, ${input.sourceId}, ${tx.json(input.evidence)})
    ON CONFLICT DO NOTHING`;
  const [row] = await tx`SELECT source_id FROM source_account_bindings
    WHERE platform = ${input.platform} AND id_kind = ${input.idKind} AND id_value = ${input.idValue} FOR UPDATE`;
  if (row?.source_id !== input.sourceId) throw new Error("Account identity already belongs to another source");
}
