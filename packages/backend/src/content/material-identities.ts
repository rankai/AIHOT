import { z } from "zod";
import type { Db } from "../db.ts";
import { toutiaoWorkId, douyinVideoId, xiaohongshuNoteId, tiktokVideoId, bilibiliVideoId, youtubeVideoId, instagramCode, identityKeyForUrl, normalizeUrl } from "../lib/url.ts";

// Supplied only by a backend adapter after validating IDs from the same work record.
const WeiboConfirmation = z.object({
  platform: z.literal("weibo"),
  opusId: z.string().regex(/^[0-9]+$/).max(100),
  mblogid: z.string().regex(/^[A-Za-z0-9]+$/).max(100),
  uid: z.string().regex(/^[0-9]+$/).max(100),
  evidence: z.object({ kind: z.enum(["receipt", "result", "audit"]), reference: z.string().trim().min(1).max(200) }).strict(),
}).strict();
const WechatConfirmation=z.object({platform:z.literal("wechat"),requestedUrl:z.string(),responseUrl:z.string(),longUrl:z.string(),bizInfo:z.string().min(1),mid:z.string().regex(/^\d+$/),idx:z.string().regex(/^\d+$/),sourceId:z.string().min(1),evidence:z.object({kind:z.literal("result"),reference:z.string().regex(/^[1-9][0-9]*$/)}).strict()}).strict();
const Confirmation=z.discriminatedUnion("platform",[WeiboConfirmation,WechatConfirmation]);
export type ConfirmedWorkIdentity = z.infer<typeof Confirmation>;
export class MaterialIdentityConflict extends Error {
  code = "conflict";
}
const key = (kind: "opusId" | "mblogid", value: string) => `weibo:${kind}:${value}`;

const permalinkKeys = (token: string) => [key("mblogid", token), ...(/^[0-9]+$/.test(token) ? [key("opusId", token)] : [])];

/** Only explicit work permalink shapes. No short-link resolution or ID conversion. */
function urlIdentity(url: string): { keys: string[]; uid?: string } | null {
  const normalized = normalizeUrl(url);
  if (!normalized) return null;
  const u = new URL(normalized);
  if (u.port || u.username || u.password || new URL(url).hash) return null;
  let match: RegExpExecArray | null;
  if (u.hostname === "weibo.com" && (match = /^\/([0-9]+)\/([A-Za-z0-9]+)\/?$/.exec(u.pathname))) {
    return { keys: permalinkKeys(match[2]!), uid: match[1]! };
  }
  if (u.hostname === "m.weibo.cn" && (match = /^\/detail\/([0-9]+)\/?$/.exec(u.pathname))) return { keys: [key("opusId", match[1]!)] };
  if (u.hostname === "m.weibo.cn" && (match = /^\/status\/([A-Za-z0-9]+)\/?$/.exec(u.pathname))) return { keys: permalinkKeys(match[1]!) };
  return null;
}

export async function resolveMaterialIdentity(db: Db, input: { url: string; identityKey: string; confirmedIdentity?: ConfirmedWorkIdentity }) {
  const confirmed = input.confirmedIdentity === undefined ? undefined : Confirmation.parse(input.confirmedIdentity);
  const address=normalizeUrl(input.url),wechat=address&&new URL(address).hostname==='mp.weixin.qq.com';
  if(confirmed?.platform==='wechat'||(!confirmed&&wechat&&input.identityKey===identityKeyForUrl(input.url))){
    const keys=[input.identityKey];
    if(confirmed?.platform==='wechat'){
      const requested=normalizeUrl(confirmed.requestedUrl),response=normalizeUrl(confirmed.responseUrl),long=normalizeUrl(confirmed.longUrl);
      if(!requested||requested!==response||!long||address!==long||input.identityKey!==identityKeyForUrl(long))throw new MaterialIdentityConflict('WeChat same-response URL proof disagrees');
      const shortUrl=new URL(requested),longUrl=new URL(long);
      if(shortUrl.hostname!=='mp.weixin.qq.com'||!/^\/s\/[A-Za-z0-9_-]+$/.test(shortUrl.pathname)||longUrl.hostname!=='mp.weixin.qq.com'||longUrl.pathname!=='/s'||longUrl.searchParams.get('__biz')!==confirmed.bizInfo||longUrl.searchParams.get('mid')!==confirmed.mid||longUrl.searchParams.get('idx')!==confirmed.idx)throw new MaterialIdentityConflict('WeChat article tuple proof disagrees');
      keys.push(identityKeyForUrl(requested)!);
    }
    for(const k of [...new Set(keys)].sort())await db`SELECT pg_advisory_xact_lock(hashtextextended(${`material:${k}`},0))`;
    const rows=await db<{id:string;identity_key:string}[]>`SELECT id,identity_key FROM articles WHERE identity_key IN ${db(keys)} OR id IN (SELECT article_id FROM article_identity_aliases WHERE alias_key IN ${db(keys)}) ORDER BY id FOR UPDATE`;
    if(rows.length>1)throw new MaterialIdentityConflict('WeChat original URLs belong to different articles');
    return {identityKey:rows[0]?.identity_key??input.identityKey,aliases:confirmed?keys:[],evidence:confirmed?.evidence};
  }
  const toutiaoId = toutiaoWorkId(input.url);
  const explicitToutiao = /^toutiao:workId:[0-9]+$/.test(input.identityKey);
  if (!confirmed && (toutiaoId || explicitToutiao)) {
    if (!explicitToutiao && input.identityKey !== identityKeyForUrl(input.url)) return null;
    const primary = `toutiao:workId:${toutiaoId}`;
    if (!toutiaoId || (explicitToutiao && input.identityKey !== primary)) throw new MaterialIdentityConflict("Toutiao work ID does not match its native original");
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`material:${primary}`}, 0))`;
    const mobile = `url:https://m.toutiao.com/article/${toutiaoId}`;
    // Preserve the desktop legacy index expression; mobile lookup stays scoped to this exact work.
    const rows = await db<{ id: string; identity_key: string }[]>`SELECT id, identity_key FROM articles
      WHERE identity_key = ${primary} OR (
        identity_key ~ '^url:https://toutiao[.]com/(?:a|group/|article/|video/)[0-9]+/?([?][^#]*)?$'
        AND substring(identity_key from '^url:https://toutiao[.]com/(?:a|group/|article/|video/)([0-9]+)/?([?][^#]*)?$') = ${toutiaoId})
        OR (identity_key NOT LIKE '%#%' AND (identity_key IN ${db([mobile, mobile + "/"])}
          OR identity_key LIKE ${mobile + "?%"} OR identity_key LIKE ${mobile + "/?%"}))
      ORDER BY id LIMIT 2 FOR UPDATE`;
    if (rows.length > 1) throw new MaterialIdentityConflict("Toutiao work already belongs to different articles");
    return { identityKey: rows[0]?.identity_key ?? primary, aliases: [] as string[], evidence: undefined };
  }
  const code = instagramCode(input.url);
  const explicitInstagram = /^instagram:code:[A-Za-z0-9_-]+$/.test(input.identityKey);
  if (!confirmed && (code || explicitInstagram)) {
    if (!explicitInstagram && input.identityKey !== identityKeyForUrl(input.url)) return null;
    const primary = `instagram:code:${code}`;
    if (!code || (explicitInstagram && input.identityKey !== primary)) throw new MaterialIdentityConflict("Instagram shortcode does not match its native original");
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`material:${primary}`}, 0))`;
    const p = `url:https://instagram.com/p/${code}`, reel = `url:https://instagram.com/reel/${code}`;
    const escape = (value:string) => value.replace(/[\\%_]/g, char => `\\${char}`);
    const rows = await db<{ id:string; identity_key:string }[]>`SELECT id,identity_key FROM articles
      WHERE identity_key=${primary} OR (
        (identity_key LIKE 'url:https://instagram.com/p/%' OR identity_key LIKE 'url:https://instagram.com/reel/%') AND identity_key NOT LIKE '%#%'
        AND (identity_key IN ${db([p,p+"/",reel,reel+"/"])}
          OR identity_key LIKE ${escape(p)+"?%"} OR identity_key LIKE ${escape(p)+"/?%"}
          OR identity_key LIKE ${escape(reel)+"?%"} OR identity_key LIKE ${escape(reel)+"/?%"}))
      ORDER BY id LIMIT 2 FOR UPDATE`;
    if(rows.length>1)throw new MaterialIdentityConflict("Instagram shortcode already belongs to different articles");
    return {identityKey:rows[0]?.identity_key??primary,aliases:[] as string[],evidence:undefined};
  }
  const videoId = youtubeVideoId(input.url);
  const explicitYoutube = /^youtube:videoId:[A-Za-z0-9_-]{11}$/.test(input.identityKey);
  if (!confirmed && (videoId || explicitYoutube)) {
    if (!explicitYoutube && input.identityKey !== identityKeyForUrl(input.url)) return null;
    const primary = `youtube:videoId:${videoId}`;
    if (!videoId || (explicitYoutube && input.identityKey !== primary)) throw new MaterialIdentityConflict("YouTube video ID does not match its native watch address");
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`material:${primary}`}, 0))`;
    // The expression and predicate match the scoped legacy index, regardless of query order.
    const rows = await db<{ id: string; identity_key: string }[]>`SELECT id, identity_key FROM articles
      WHERE identity_key = ${primary} OR (
        identity_key LIKE 'url:https://youtube.com/watch?%' AND identity_key NOT LIKE '%#%'
        AND regexp_count(identity_key, '[?&]v(?=[=&]|$)') = 1
        AND substring(identity_key from '[?&]v=([A-Za-z0-9_-]{11})(&|$)') IS NOT NULL
        AND substring(identity_key from '[?&]v=([A-Za-z0-9_-]{11})(&|$)') = ${videoId})
      ORDER BY id LIMIT 2 FOR UPDATE`;
    if (rows.length > 1) throw new MaterialIdentityConflict("YouTube native video already belongs to different articles");
    return { identityKey: rows[0]?.identity_key ?? primary, aliases: [] as string[], evidence: undefined };
  }
  const bvId = bilibiliVideoId(input.url);
  const explicitBilibili = /^bilibili:bvId:BV[A-Za-z0-9]{10}$/.test(input.identityKey);
  if (!confirmed && (bvId || explicitBilibili)) {
    if (!explicitBilibili && input.identityKey !== identityKeyForUrl(input.url)) return null;
    const primary = `bilibili:bvId:${bvId}`;
    if (!bvId || (explicitBilibili && input.identityKey !== primary)) throw new MaterialIdentityConflict("Bilibili BV does not match its native video address");
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`material:${primary}`}, 0))`;
    const generic = `url:https://bilibili.com/video/${bvId}`;
    const rows = await db<{ id: string; identity_key: string }[]>`SELECT id, identity_key FROM articles
      WHERE identity_key = ${primary} OR (
        identity_key LIKE 'url:https://bilibili.com/video/BV%' AND identity_key NOT LIKE '%#%'
        AND (identity_key = ${generic} OR identity_key = ${generic + "/"}
          OR identity_key LIKE ${generic + "?%"} OR identity_key LIKE ${generic + "/?%"}))
      ORDER BY id LIMIT 2 FOR UPDATE`;
    if (rows.length > 1) throw new MaterialIdentityConflict("Bilibili native video already belongs to different articles");
    return { identityKey: rows[0]?.identity_key ?? primary, aliases: [] as string[], evidence: undefined };
  }
  const tiktokId = tiktokVideoId(input.url);
  const explicitTiktok = /^tiktok:workId:[0-9]+$/.test(input.identityKey);
  if (!confirmed && (tiktokId || explicitTiktok)) {
    if (!explicitTiktok && input.identityKey !== identityKeyForUrl(input.url)) return null;
    const primary = `tiktok:workId:${tiktokId}`;
    if (!tiktokId || (explicitTiktok && input.identityKey !== primary)) throw new MaterialIdentityConflict("TikTok work ID does not match its native video address");
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`material:${primary}`}, 0))`;
    // The expression and predicate match the scoped legacy index. No custom key or fragment is an owner.
    const rows = await db<{ id: string; identity_key: string }[]>`SELECT id, identity_key FROM articles
      WHERE identity_key = ${primary} OR (
        identity_key ~ '^url:https://tiktok[.]com/@[A-Za-z0-9_.-]+/video/[0-9]+/?([?][^#]*)?$'
        AND substring(identity_key from '^url:https://tiktok[.]com/@[A-Za-z0-9_.-]+/video/([0-9]+)/?([?][^#]*)?$') = ${tiktokId})
      ORDER BY id LIMIT 2 FOR UPDATE`;
    if (rows.length > 1) throw new MaterialIdentityConflict("TikTok native work already belongs to different articles");
    return { identityKey: rows[0]?.identity_key ?? primary, aliases: [] as string[], evidence: undefined };
  }
  const noteId = xiaohongshuNoteId(input.url);
  const explicitNote = /^xiaohongshu:noteId:[A-Za-z0-9_-]+$/.test(input.identityKey);
  if (!confirmed && (noteId || explicitNote)) {
    if (!explicitNote && input.identityKey !== identityKeyForUrl(input.url)) return null;
    const primary = `xiaohongshu:noteId:${noteId}`;
    if (!noteId || (explicitNote && input.identityKey !== primary)) throw new MaterialIdentityConflict("Xiaohongshu note ID does not match its native address");
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`material:${primary}`}, 0))`;
    const generic = `url:https://xiaohongshu.com/explore/${noteId}`;
    const discovery = `url:https://xiaohongshu.com/discovery/item/${noteId}`;
    // Escape opaque IDs for LIKE; '?' delimits this exact path, never a longer note ID.
    const escaped = generic.replace(/[\\%_]/g, value => `\\${value}`);
    const discoveryEscaped = discovery.replace(/[\\%_]/g, value => `\\${value}`);
    const rows = await db<{ id: string; identity_key: string }[]>`SELECT id, identity_key FROM articles
      WHERE identity_key = ${primary} OR (identity_key NOT LIKE '%#%' AND (
        (identity_key LIKE 'url:https://xiaohongshu.com/explore/%'
          AND (identity_key = ${generic} OR identity_key = ${generic + "/"}
            OR identity_key LIKE ${escaped + "?%"} OR identity_key LIKE ${escaped + "/?%"}))
        OR (identity_key LIKE 'url:https://xiaohongshu.com/discovery/item/%'
          AND (identity_key = ${discovery} OR identity_key = ${discovery + "/"}
            OR identity_key LIKE ${discoveryEscaped + "?%"} OR identity_key LIKE ${discoveryEscaped + "/?%"}))))
      ORDER BY id LIMIT 2 FOR UPDATE`;
    if (rows.length > 1) throw new MaterialIdentityConflict("Xiaohongshu native note already belongs to different articles");
    return { identityKey: rows[0]?.identity_key ?? primary, aliases: [] as string[], evidence: undefined };
  }
  const douyinId = douyinVideoId(input.url);
  const explicitDouyin = /^douyin:aweme_id:[0-9]+$/.test(input.identityKey);
  if (!confirmed && (douyinId || explicitDouyin)) {
    if (!explicitDouyin && input.identityKey !== identityKeyForUrl(input.url)) return null;
    const primary = `douyin:aweme_id:${douyinId}`;
    if (!douyinId || (explicitDouyin && input.identityKey !== primary)) throw new MaterialIdentityConflict("Douyin work ID does not match its native video address");
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`material:${primary}`}, 0))`;
    const urls = new Set([input.url]);
    for (const scheme of ["http", "https"]) for (const www of ["", "www."]) for (const suffix of ["", "/"]) {
      urls.add(`${scheme}://${www}douyin.com/video/${douyinId}${suffix}`);
      urls.add(`${scheme}://${www}iesdouyin.com/share/video/${douyinId}${suffix}`);
    }
    const keys = [...new Set([primary, ...[...urls].map(url => identityKeyForUrl(url)).filter((k): k is string => k !== null)])];
    const rows = await db<{ id: string; identity_key: string }[]>`SELECT id, identity_key FROM articles
      WHERE identity_key IN ${db(keys)} ORDER BY id FOR UPDATE`;
    if (rows.length > 1) throw new MaterialIdentityConflict("Douyin native work already belongs to different articles");
    return { identityKey: rows[0]?.identity_key ?? primary, aliases: [] as string[], evidence: undefined };
  }
  const parsed = urlIdentity(input.url);
  const explicit = /^weibo:(opusId:[0-9]+|mblogid:[A-Za-z0-9]+)$/.test(input.identityKey) ? input.identityKey : null;
  // Preserve custom identities (including fragments) unless a trusted adapter explicitly confirms.
  if (!confirmed && !explicit && input.identityKey !== identityKeyForUrl(input.url)) return null;
  const aliases = confirmed ? [key("opusId", confirmed.opusId), key("mblogid", confirmed.mblogid)] : [];
  if (confirmed && (!parsed || !parsed.keys.some(k => aliases.includes(k)) || (parsed.uid && parsed.uid !== confirmed.uid) ||
    (explicit ? !aliases.includes(explicit) : input.identityKey !== identityKeyForUrl(input.url)))) {
    throw new MaterialIdentityConflict("Confirmed work identifiers do not match the material address or primary identity");
  }
  if (!confirmed && !parsed && !explicit) return null;
  const keys = [...new Set([...aliases, ...(parsed?.keys ?? []), ...(explicit ? [explicit] : [])])].sort();
  // Every supported URL-only writer takes the same typed key lock, even before an alias exists.
  for (const k of keys) await db`SELECT pg_advisory_xact_lock(hashtextextended(${`material:${k}`}, 0))`;
  const urls = new Set([input.url]);
  if (confirmed) {
    for (const token of [confirmed.opusId, confirmed.mblogid]) for (const host of ["weibo.com", "www.weibo.com"]) {
      for (const scheme of ["http", "https"]) urls.add(`${scheme}://${host}/${confirmed.uid}/${token}`);
    }
    urls.add(`https://m.weibo.cn/detail/${confirmed.opusId}`);
    urls.add(`https://m.weibo.cn/status/${confirmed.mblogid}`);
  }
  const primaryKeys = [...new Set([input.identityKey, ...keys, ...[...urls].map(url => identityKeyForUrl(url)).filter((v): v is string => v !== null)])];
  const rows = await db<{ id: string; identity_key: string }[]>`
    SELECT id, identity_key FROM articles WHERE identity_key IN ${db(primaryKeys)} OR url IN ${db([...urls])}
    OR id IN (SELECT article_id FROM article_identity_aliases WHERE alias_key IN ${db(keys)})
    ORDER BY id FOR UPDATE`;
  if (rows.length > 1) throw new MaterialIdentityConflict("Confirmed work identifiers already belong to different articles");
  return { identityKey: rows[0]?.identity_key ?? (confirmed ? key("opusId", confirmed.opusId) : input.identityKey), aliases, evidence: confirmed?.evidence };
}

export async function saveMaterialAliases(db: Db, articleId: string, resolution: NonNullable<Awaited<ReturnType<typeof resolveMaterialIdentity>>>) {
  for (const alias of resolution.aliases) {
    await db`INSERT INTO article_identity_aliases(alias_key,article_id,evidence)
      VALUES (${alias},${articleId},${db.json(resolution.evidence!)}) ON CONFLICT DO NOTHING`;
    const [row] = await db`SELECT article_id FROM article_identity_aliases WHERE alias_key=${alias}`;
    if (row?.article_id !== articleId) throw new MaterialIdentityConflict("Work alias already belongs to another article");
  }
}
