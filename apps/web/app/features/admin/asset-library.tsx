import type { MediaUploadOptions } from "./media-upload-data";
import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { mergeAssetRows } from "./asset-data";
import type { AssetUploadOptions } from "./asset-types";
import { AssetUpload } from "./asset-upload";
import type { AssetPage, ImageOptions, PrivateAsset } from "./image-types";
import { PrivateAssetView } from "./private-asset";
import { Button, Card, Empty } from "./ui";

export function AssetLibrary({ initialPage, uploadOptions, imageOptions, updates, onAssetChange, supplierUploadOptions }: { supplierUploadOptions: MediaUploadOptions; initialPage: AssetPage; uploadOptions: AssetUploadOptions; imageOptions: ImageOptions; updates: PrivateAsset[]; onAssetChange: (asset: PrivateAsset) => void }) {
  const more = useFetcher<{ assets: AssetPage }>();
  const [page, setPage] = useState(initialPage);
  useEffect(() => {
    if (more.data) { const next = more.data.assets; setPage(previous => ({ items: mergeAssetRows(previous.items, next.items), nextCursor: next.nextCursor })); }
  }, [more.data]);
  const assets = mergeAssetRows(mergeAssetRows(initialPage.items, page.items), updates);
  return <div className="space-y-5">
    <Card title="本地私有素材上传"><AssetUpload options={uploadOptions} onUploaded={onAssetChange} /></Card>
    <Card title="私有素材" right={<Link className="text-accent" to="/admin/data-tools?view=assets">素材库入口链接</Link>}>
      <p className="mb-3 text-[12px] text-ink-3">已载入 {assets.length} 项，仅使用私有内容地址。图片可本地预览；音视频按需播放，不自动播放或预载内容；文本附件仅提供私有下载，不支持普通上传或上传到供应商。删除记录在当前列表保留，不能再用作参考。</p>
      {assets.length ? <div className="grid gap-5 xl:grid-cols-2">{assets.map(asset => <div key={asset.key} className="min-w-0 rounded-control border border-line p-3"><PrivateAssetView asset={asset} options={imageOptions} compact onChange={onAssetChange} uploadOptions={supplierUploadOptions} /></div>)}</div> : <Empty>还没有载入的本地私有素材，可先上传文件。</Empty>}
      {page.nextCursor && <Button className="mt-4" busy={more.state !== "idle"} disabled={more.state !== "idle"} onClick={() => more.load(`/admin/data-tools?view=assets&after=${encodeURIComponent(page.nextCursor!)}`)}>加载更多素材</Button>}
    </Card>
  </div>;
}
