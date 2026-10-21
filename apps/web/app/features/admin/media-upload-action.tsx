import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { useAdminAction } from "./action";
import { mediaUploadCommand, mediaUploadIssue, type MediaUploadOptions } from "./media-upload-data";
import type { PrivateAsset } from "./image-types";
import type { OperationAccepted } from "./operation-types";
import { Button, ReasonDialog } from "./ui";
export function MediaUploadAction({ asset, options }: { asset: PrivateAsset; options: MediaUploadOptions }) {
  const navigate = useNavigate(), { run, pending } = useAdminAction(), [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []), issue = mediaUploadIssue(asset, options);
  return <div className="space-y-2">
    <Button size="sm" disabled={!!issue || !!pending} onClick={() => setOpen(true)}>上传到 Redfox</Button>
    {issue && <p className="text-[12px] text-ink-3">{issue}</p>}
    <ReasonDialog open={open} title="上传私有素材到 Redfox" requireReason={false} showOptionalReason={false} confirmLabel="确认上传到 Redfox" busy={!!pending} onClose={close} description={<><p className="break-all">将把“{asset.metadata.filename}”传给第三方 Redfox。此动作使用 media 次数预算，可能计费；估价与实际请求请查看预算设置和回执。</p><p className="mt-2">上传结果未知时需要人工核对，不会自动重发。停止本地任务不会取消已发出的上传，也不保证退款。</p>{!options.transportVerified && <p className="mt-2 text-amber">真实文件传输尚未验证，提交不代表供应商已可用。</p>}</>} onSubmit={async () => {
      let command: ReturnType<typeof mediaUploadCommand>;
      try { command = mediaUploadCommand(asset, options); } catch { return false; }
      const result = await run<OperationAccepted>("POST", command.path, command.body, { label: "supplier-upload", revalidate: false });
      if (!result) return false;
      navigate(`/admin/operations/${result.runId}`); return true;
    }} />
  </div>;
}
