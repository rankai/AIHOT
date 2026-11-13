import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Presence } from "./Presence";
import { IconArrowLeft, IconArrowRight, IconClose } from "../icons";

export interface LightboxImage {
  src: string;
  alt?: string | null;
}

/**
 * Pictures shown full size over the page. While open, keyboard focus stays in the viewer (Tab moves
 * between its buttons), the page behind does not scroll, Escape closes it and the arrow keys move
 * between pictures; closing puts focus back where it was.
 */
export function Lightbox({ images, index, onIndex, onClose, allowOriginalSize = false }: { images: LightboxImage[]; index: number | null; onIndex: (i: number) => void; onClose: () => void; allowOriginalSize?: boolean }) {
  const open = index !== null && !!images[index];
  const current = open ? images[index!]! : null;
  const [originalSrc, setOriginalSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const original = allowOriginalSize && !!current && originalSrc === current.src;
  const viewport = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const state = useRef({ index, count: images.length, onIndex, onClose, original });
  state.current = { index, count: images.length, onIndex, onClose, original };
  useEffect(() => { if (!open) { setOriginalSrc(null); setFailedSrc(null); } }, [open]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    closeButton.current?.focus({ preventScroll: true });
    const step = (by: number) => {
      const { index: at, count, onIndex: go } = state.current;
      if (at !== null && count > 1) go((at + by + count) % count);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") state.current.onClose();
      else if (e.key === "ArrowRight" && !state.current.original) step(1);
      else if (e.key === "ArrowLeft" && !state.current.original) step(-1);
      else if (e.key === "Tab") {
        const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button, [tabindex="0"]') ?? [])];
        if (!focusable.length) return;
        const at = focusable.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (at <= 0 ? focusable.length - 1 : at - 1) : at === focusable.length - 1 ? 0 : at + 1;
        focusable[next]!.focus();
      } else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      root.style.overflow = overflow;
      opener?.focus({ preventScroll: true });
    };
  }, [open]);

  const many = images.length > 1;
  const nav = "absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20";
  if (typeof document === "undefined") return null;
  return createPortal(
    <Presence show={open} enter="anim-fade-in" exit="anim-fade-out" duration={160}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={many && index !== null ? `图片 ${index + 1} / ${images.length}` : "图片"}
        onClick={onClose}
        className="fixed inset-0 z-[80] grid cursor-zoom-out place-items-center bg-black/85 p-4 sm:p-10"
      >
        {current && allowOriginalSize ? <>
          <div ref={viewport} tabIndex={0} role="region" aria-label="图片细节滚动区域" onClick={event => event.stopPropagation()}
            className="absolute inset-x-4 bottom-4 top-16 overflow-auto overscroll-contain rounded-control outline-offset-2 cursor-default focus-visible:outline-2 focus-visible:outline-white">
            {failedSrc === current.src ? <p role="status" className="p-6 text-center text-[14px] text-white">图片暂不可读，请关闭后重新打开。不会重新生成图片。</p> :
              <div className={original ? "grid min-h-full min-w-full w-max place-items-center" : "grid h-full w-full place-items-center"}>
                <img key={current.src} src={current.src} decoding="async" alt={current.alt ?? ""} onError={() => setFailedSrc(current.src)}
                  className={original ? "lightbox-img h-auto w-auto max-w-none rounded-control" : "lightbox-img min-h-0 min-w-0 max-h-full max-w-full rounded-control object-contain shadow-2xl"} />
              </div>}
          </div>
          <div className="absolute left-4 top-4 flex gap-1 rounded-full bg-black/40 p-1 text-[12px] text-white" onClick={event => event.stopPropagation()}>
            <button type="button" aria-pressed={!original} className={`rounded-full px-3 py-1.5 ${!original ? "bg-white/20" : ""}`} onClick={() => setOriginalSrc(null)}>适应屏幕</button>
            <button type="button" aria-pressed={original} className={`rounded-full px-3 py-1.5 ${original ? "bg-white/20" : ""}`} onClick={() => { setOriginalSrc(current.src); viewport.current?.focus({ preventScroll: true }); }}>原始大小</button>
          </div>
        </> : current && (
          <img key={current.src} src={current.src} decoding="async" alt={current.alt ?? ""} className="lightbox-img anim-zoom-in min-h-0 min-w-0 max-h-[calc(100dvh-5rem)] max-w-full rounded-control object-contain shadow-2xl" />
        )}
        <button ref={closeButton} type="button" aria-label="关闭" onClick={onClose} className="absolute right-4 top-4 grid size-9 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20">
          <IconClose size={18} />
        </button>
        {many && index !== null && (
          <>
            <button type="button" aria-label="上一张" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + images.length) % images.length); }} className={`${nav} left-3 sm:left-5`}>
              <IconArrowLeft size={18} />
            </button>
            <button type="button" aria-label="下一张" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % images.length); }} className={`${nav} right-3 sm:right-5`}>
              <IconArrowRight size={18} />
            </button>
            <span className="num pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-2.5 py-0.5 text-[12px] text-white/85">
              {index + 1} / {images.length}
            </span>
          </>
        )}
      </div>
    </Presence>, document.body
  );
}
