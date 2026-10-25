import { useState } from "react";
import type { VideoPreview } from "@aihot/contracts/site";
import { IconMonitor } from "../../components/icons";

/** A still image or local placeholder; playback always stays on the original site. */
export function VideoPoster({ video, className = "" }: { video: VideoPreview; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`relative grid aspect-video w-full place-items-center overflow-hidden rounded-control border border-line-soft bg-bg-sunk text-ink-4 ${className}`}>
      {video.poster && !failed ? <img ref={(image) => {
        // SSR images may fail before hydration attaches onError; ref runs when React mounts them.
        if (image?.complete && image.naturalWidth === 0) setFailed(true);
      }} src={video.poster} srcSet={video.posterSrcSet} sizes="(min-width: 1024px) 480px, 90vw" alt="视频封面" loading="lazy" decoding="async" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" /> : <span className="flex items-center gap-2 text-[12px]"><IconMonitor size={20} />视频 · 原站观看</span>}
      {video.poster && !failed && <span className="absolute bottom-2 right-2 rounded-mark bg-black/60 px-2 py-1 text-[11px] text-white">视频</span>}
    </div>
  );
}
