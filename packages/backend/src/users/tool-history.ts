import { z } from "zod";
import type { ToolRunCategory, ToolRunRow, ToolRunPage } from "@aihot/contracts/user-tools";
import { sql, type Db } from "../db.ts";
import { platformToolCatalog } from "../providers/redfox/catalog.ts";
import { imageOptions } from "../providers/redfox/images.ts";
import { aiSearchEngines } from "../providers/redfox/ai-search-contract.ts";
import { ToolId } from "./tool-input.ts";
import { AccountError } from "./accounts.ts";

// Explicit query targets from the supported contracts; never derive this from all input keys.
const historySummaryFields = [
  "prompt", "inquiryText", "keyword", "keywords", "query", "search", "searchKeyword", "searchKey", "content", "text",
  "screenName", "username", "userName", "accountName", "url", "videoUrl", "audioUrl", "shareUrl", "opusUrl", "userId", "uid",
  "accountId", "opusId", "tweetId", "workId", "videoId", "channelId", "noteId", "bvid", "awemeId", "secUid",
  "screen_name", "rest_id", "tweet_id", "list_id", "community_id", "status_id", "group_id", "user_id",
  "av_id", "bv_id", "sec_user_id", "aweme_id", "note_id", "page_id", "item_id", "ch_id",
  "account", "wxId", "bizInfo", "workUuid", "articleUrl", "authorUrl", "secUserId", "uniqueName", "shortId", "workUrl", "workLink",
  "redId", "userid", "bvId", "mid", "accountUrl", "searchQuery", "codeOrUrl", "nickname", "kwaiId", "threeXId", "photoId", "name",
  "authorId", "articleId", "svId", "uk", "keyWord", "keword", "itemId",
];

export type MemberRunRow = {
  id: number; actor: string; provider: string; operation_key: string; status: ToolRunRow["status"];
  created_at: Date; step_version: number; generation: number; step_key: string; receipt_status: string | null;
  category: ToolRunCategory; title: string; summary: string; origin_run_id: number | null; continuation_run_id: number | null;
};
export const memberRunDto = (row: MemberRunRow): ToolRunRow => ({ id: row.id, provider: row.provider, operationKey: row.operation_key,
  category: row.category, title: row.title, summary: row.summary, status: row.status, createdAt: row.created_at.toISOString(), stepVersion: row.step_version, generation: row.generation });

// Recovery links require the persisted shared charge, matching actors and matching operation family.
// A user-controlled reference in input alone cannot expose another task or its input.
function runRelations() {
  return sql`FROM operation_runs r
    LEFT JOIN receipts receipt ON receipt.id=r.current_receipt_id
    LEFT JOIN member_credit_run_links link ON link.run_id=r.id
    LEFT JOIN member_credit_charges charge ON charge.id=link.charge_id AND ('user:' || charge.user_id::text)=r.actor
    LEFT JOIN operation_runs origin ON origin.id=charge.root_run_id AND link.recovery AND origin.actor=r.actor
      AND r.input->'memberRecovery'->>'parentRunId'=origin.id::text
      AND regexp_replace(origin.operation_key,'\\.(generate|submit)$','.query')=r.operation_key
    LEFT JOIN member_credit_run_links child_link ON child_link.charge_id=charge.id AND child_link.recovery AND NOT link.recovery
    LEFT JOIN operation_runs child ON child.id=child_link.run_id AND child.actor=r.actor
      AND child.input->'memberRecovery'->>'parentRunId'=r.id::text
      AND regexp_replace(r.operation_key,'\\.(generate|submit)$','.query')=child.operation_key
    CROSS JOIN LATERAL (SELECT COALESCE(origin.input,r.input) AS input) effective
    CROSS JOIN LATERAL (SELECT effective.input->'parameters' AS p) parameters`;
}

export async function memberRunPresentation() {
  const catalog = await platformToolCatalog();
  const labels = Object.fromEntries(catalog.filter(tool => tool.platform !== "redfox-account").map(tool => [tool.id, tool.label]));
  const modelLabels = Object.fromEntries(imageOptions().models.map(model => [model.model, model.label]));
  const engineLabels = Object.fromEntries(Object.entries(aiSearchEngines).map(([key, value]) => [key, value.label]));
  return { query: sql`SELECT r.id,r.actor,r.provider,r.operation_key,r.status,r.created_at,r.step_version,r.generation,r.step_key,
    receipt.status AS receipt_status,origin.id AS origin_run_id,child.id AS continuation_run_id,
    CASE WHEN r.operation_key IN ('redfox.image.generate','redfox.image.query') THEN 'images'
      WHEN r.operation_key IN ('redfox.video.generate','redfox.video.query','aliyun.wan.animate-mix.generate','aliyun.wan.animate-mix.query') THEN 'videos'
      WHEN r.operation_key IN ('redfox.ai_search.submit','redfox.ai_search.query') THEN 'ai-search'
      WHEN r.operation_key IN ('redfox.transcript.submit','redfox.transcript.query') THEN 'transcriptions'
      WHEN r.operation_key IN ('redfox.xhs_comments.submit','redfox.xhs_comments.query') THEN 'xhs-comments'
      WHEN r.operation_key='redfox.media.upload' THEN 'media-upload' ELSE 'query' END AS category,
    COALESCE(${sql.json(labels)}::jsonb->>(effective.input->>'operationId'),
      CASE WHEN r.operation_key='redfox.x.account' THEN 'X 账号查询' WHEN r.operation_key='redfox.x.detail' THEN 'X 帖子详情'
        WHEN r.operation_key IN ('redfox.image.generate','redfox.image.query') THEN COALESCE(${sql.json(modelLabels)}::jsonb->>(p->>'model'),'Redfox GPT-Image-2') || ' 图片创作'
        WHEN r.operation_key IN ('aliyun.wan.animate-mix.generate','aliyun.wan.animate-mix.query') THEN '万相 视频复刻'
        WHEN r.operation_key IN ('redfox.video.generate','redfox.video.query') THEN 'Seedance 视频创作'
        WHEN r.operation_key IN ('redfox.ai_search.submit','redfox.ai_search.query') THEN COALESCE(${sql.json(engineLabels)}::jsonb->>(p->>'engine'),'AI') || ' 搜索'
        WHEN r.operation_key IN ('redfox.transcript.submit','redfox.transcript.query') THEN '音视频转文字'
        WHEN r.operation_key IN ('redfox.xhs_comments.submit','redfox.xhs_comments.query') THEN '小红书评论查询'
        WHEN r.operation_key='redfox.media.upload' THEN '素材上传' ELSE '数据查询' END) AS title,
    left(regexp_replace(regexp_replace(COALESCE(summary.value,''),'[[:cntrl:]]',' ','g'),'[[:space:]]+',' ','g'),240) AS summary
    ${runRelations()}
    LEFT JOIN LATERAL (SELECT CASE WHEN entry.value ~* '^https?://' THEN
        regexp_replace(regexp_replace(entry.value,'[?#].*$',''), '^(https?://)[^/@]+@', '\\1', 'i') ELSE entry.value END AS value
      FROM jsonb_each_text(CASE WHEN jsonb_typeof(p)='object' THEN p ELSE '{}'::jsonb END) entry
      WHERE entry.key = ANY(${sql.array(historySummaryFields)}::text[])
        AND jsonb_typeof(p->entry.key) IN ('string','number')
        AND nullif(trim(entry.value),'') IS NOT NULL
      ORDER BY CASE entry.key WHEN 'prompt' THEN 0 WHEN 'inquiryText' THEN 1 WHEN 'keyword' THEN 2 WHEN 'query' THEN 3 ELSE 4 END,entry.key LIMIT 1) summary ON true` };
}

export async function listUserTools(actor: string, raw: unknown): Promise<ToolRunPage> {
  const { after, q, status, category } = z.object({ after: z.coerce.number().int().positive().safe().optional(), q: z.string().trim().max(120).optional(),
    status: z.enum(["active","waiting","needs_review","stopped","completed","failed"]).optional(),
    category: z.enum(["query","ai-search","images","videos","transcriptions","xhs-comments","media-upload"]).optional() }).strict().parse(raw);
  // Present and filter only this actor's rows, before the cursor page is selected. strpos treats %/_/\\ literally.
  const rows = await sql<MemberRunRow[]>`WITH owned AS (${(await memberRunPresentation()).query} WHERE r.actor=${actor} AND (${after ?? null}::bigint IS NULL OR r.id<${after ?? null}))
    SELECT * FROM owned WHERE (${status ?? null}::text IS NULL OR status=${status ?? null})
      AND (${category ?? null}::text IS NULL OR category=${category ?? null})
      AND (${q ?? ""}='' OR strpos(lower(title || ' ' || summary || ' ' || id::text),lower(${q ?? ""}))>0)
    ORDER BY id DESC LIMIT 51`;
  return { rows: rows.slice(0, 50).map(memberRunDto), nextCursor: rows.length > 50 ? rows[49].id : null };
}

export async function ownedMemberRun(actor: string, id: number, db: Db = sql, presentation?: Awaited<ReturnType<typeof memberRunPresentation>>): Promise<MemberRunRow> {
  ToolId.parse(id);
  const [row] = await db<MemberRunRow[]>`${(presentation ?? await memberRunPresentation()).query} WHERE r.id=${id} AND r.actor=${actor}`;
  if (!row) throw new AccountError(404, "not_found", "执行记录不存在或不可访问");
  return row;
}
