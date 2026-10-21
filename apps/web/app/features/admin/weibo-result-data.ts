/** Shared received-field checks; import authority remains with the backend. */
export function weiboImportFields(kind: string, data: Record<string, unknown>) {
  const account = kind === "weibo_account", work = kind === "weibo_work";
  const receivedUid = typeof data.uid === "string" && data.uid ? data.uid : null;
  const receivedUrl = typeof data.opusUrl === "string" && data.opusUrl ? data.opusUrl : typeof data.url === "string" && data.url ? data.url : null;
  return { account, work, receivedUid, receivedUrl, missingUid: work && !receivedUid, missingUrl: work && !receivedUrl, canImport: account ? !!receivedUid : work && !!data.opusId };
}
