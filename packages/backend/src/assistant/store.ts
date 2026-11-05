import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, type Db, type Tx } from "../db.ts";
import { AccountError } from "../users/accounts.ts";
import { CommandKey, creditHash } from "../users/credits-core.ts";
import type { AssistantArtifactContent, AssistantSource } from "@aihot/contracts/assistant";
import { projectArticleVersions } from "./article-research.ts";
export const uuid = z.string().uuid();
export const conflict = (message: string) => new AccountError(409, "conflict", message);
export async function ownedSession(db: Db, userId: number, id: string, lock = false) {
  uuid.parse(id);
  const rows = lock
    ? await db`SELECT * FROM assistant_sessions WHERE id=${id} AND owner_user_id=${userId} AND deleted_at IS NULL FOR UPDATE`
    : await db`SELECT * FROM assistant_sessions WHERE id=${id} AND owner_user_id=${userId} AND deleted_at IS NULL`;
  if (!rows[0]) throw new AccountError(404, "not_found", "会话不存在或不可访问");
  return rows[0];
}
export async function event(tx: Tx, sessionId: string, type: string, entityId: string) {
  await tx`SELECT id FROM assistant_sessions WHERE id=${sessionId} FOR UPDATE`;
  await tx`INSERT INTO assistant_events(session_id,seq,type,entity_id) SELECT ${sessionId},coalesce(max(seq),0)+1,${type},${entityId} FROM assistant_events WHERE session_id=${sessionId}`;
}
export async function message(
  tx: Tx,
  sessionId: string,
  turnId: string | null,
  role: "user" | "assistant" | "tool",
  text: string,
  modelMessage: unknown = null,
) {
  const id = randomUUID();
  await tx`SELECT id FROM assistant_sessions WHERE id=${sessionId} FOR UPDATE`;
  await tx`INSERT INTO assistant_messages(id,session_id,seq,turn_id,role,text,model_message) SELECT ${id},${sessionId},coalesce(max(seq),0)+1,${turnId},${role},${text},${modelMessage === null ? null : tx.json(modelMessage as never)} FROM assistant_messages WHERE session_id=${sessionId}`;
  await event(tx, sessionId, "message", id);
  return id;
}
export const Content = z
  .object({
    title: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(30000),
    intent: z.enum(["outline", "draft", "rewrite"]),
    titles: z.array(z.string().min(1).max(300)).max(6),
    tags: z.array(z.string().min(1).max(80)).max(10),
    sources: z.array(z.string().min(1).max(1000)).min(1).max(50),
    partial: z.boolean(),
    scope: z.string().min(1).max(1000),
  })
  .strict();
export async function saveArtifact(
  tx: Tx,
  input: {
    sessionId: string;
    artifactId?: string;
    baseVersion: number;
    kind: "text-draft" | "xhs-note";
    content: AssistantArtifactContent;
    turnId?: string;
    activationId?: string;
    sourceSnapshot?: AssistantSource[];
  },
) {
  if (input.artifactId) {
    const [previous] = await tx`SELECT kind FROM assistant_artifact_versions WHERE session_id=${input.sessionId} AND artifact_id=${input.artifactId} LIMIT 1`;
    if (previous && !["text-draft","xhs-note"].includes(previous.kind)) throw conflict("此作品不能作为普通文本稿件编辑");
  }
  const { research, ...editable } = input.content;
  const content: AssistantArtifactContent = { ...Content.parse(editable), ...(research ? { research } : {}) },
    id = input.artifactId ? uuid.parse(input.artifactId) : randomUUID();
  await tx`SELECT id FROM assistant_sessions WHERE id=${input.sessionId} FOR UPDATE`;
  const [latest] =
    await tx`SELECT max(version)::int AS version FROM assistant_artifact_versions WHERE artifact_id=${id} AND session_id=${input.sessionId}`;
  if ((latest?.version ?? 0) !== input.baseVersion || (input.artifactId && !latest?.version))
    throw conflict("稿件版本已变化，请刷新");
  let sources = input.sourceSnapshot;
  let inheritedContent: AssistantArtifactContent | undefined;
  if (!sources && input.artifactId) {
    const [previous] =
      await tx`SELECT content,source_snapshot FROM assistant_artifact_versions WHERE session_id=${input.sessionId} AND artifact_id=${id} AND version=${input.baseVersion}`;
    sources = previous?.source_snapshot;
    if (previous) {
      const [base] = await projectArticleVersions(tx, input.sessionId, [previous as { content: AssistantArtifactContent; source_snapshot: AssistantSource[] }]);
      inheritedContent = base!.content;
    }
  }
  sources ??= [];
  if (content.sources.some((id) => !sources!.some((s) => s.id === id))) throw conflict("稿件来源不在已保存材料范围");
  if (inheritedContent) {
    content.sources = inheritedContent.sources;
    content.partial = inheritedContent.partial;
    content.scope = inheritedContent.scope;
    if (inheritedContent.research) content.research = inheritedContent.research;
  }
  sources = sources.filter((s) => content.sources.includes(s.id));
  const version = input.baseVersion + 1;
  await tx`INSERT INTO assistant_artifact_versions(session_id,artifact_id,version,base_version,kind,turn_id,activation_id,content,source_snapshot) VALUES (${input.sessionId},${id},${version},${input.baseVersion},${input.kind},${input.turnId ?? null},${input.activationId ?? null},${tx.json(content as never)},${tx.json(sources as never)})`;
  await event(tx, input.sessionId, "artifact", id);
  return { artifactId: id, version, kind: input.kind, schemaVersion: 1 as const, content, sources };
}
export function command(raw: unknown, input: unknown) {
  return { key: CommandKey.parse(raw), hash: creditHash(input) };
}
