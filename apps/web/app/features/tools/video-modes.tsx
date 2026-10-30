import { useSearchParams } from "react-router";
import { Button } from "../admin/ui";

export const VIDEO_MODES = [["text", "文生视频"], ["image", "图生视频"], ["talking", "AI口播"], ["replicate", "视频复刻"]] as const;
export type VideoMode = typeof VIDEO_MODES[number][0];

export function useVideoMode() {
  const [search, setSearch] = useSearchParams();
  const value = search.get("videoMode");
  const mode: VideoMode = VIDEO_MODES.some(([key]) => key === value) ? value as VideoMode : search.has("reference") ? "image" : "text";
  const change = (next: VideoMode) => setSearch(previous => {
    const params = new URLSearchParams(previous);
    params.set("view", "videos"); params.set("videoMode", next);
    return params;
  }, { preventScrollReset: true });
  return { mode, change };
}

export function VideoModeTabs({ mode, change, idPrefix }: { mode: VideoMode; change: (mode: VideoMode) => void; idPrefix: string }) {
  return <div role="tablist" aria-label="视频创作方式" className="flex flex-wrap gap-2 border-b border-line pb-3">{VIDEO_MODES.map(([key, label], index) => <Button key={key} id={`${idPrefix}-${key}-tab`} role="tab" aria-selected={mode === key} aria-controls={`${idPrefix}-${key}`} tabIndex={mode === key ? 0 : -1} tone={mode === key ? "primary" : "secondary"} onClick={() => change(key)} onKeyDown={event => {
    const next = event.key === "Home" ? 0 : event.key === "End" ? VIDEO_MODES.length - 1 : event.key === "ArrowRight" ? (index + 1) % VIDEO_MODES.length : event.key === "ArrowLeft" ? (index + VIDEO_MODES.length - 1) % VIDEO_MODES.length : null;
    if (next === null) return;
    event.preventDefault(); change(VIDEO_MODES[next]![0]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }}>{label}</Button>)}</div>;
}
