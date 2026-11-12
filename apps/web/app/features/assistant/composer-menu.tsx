import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Private to the composer: the caller owns the single open menu. */
export function ComposerMenu({ open, setOpen, disabled, label, title = label, className, trigger, children, onOpen, informational = false }: {
  open: boolean; setOpen: (open: boolean) => void; disabled: boolean; label: string;
  className: string; trigger: ReactNode; children: ReactNode; onOpen?: () => void; informational?: boolean; title?: string;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const last = useRef(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 0, width: 0 });
  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  }
  function items() {
    return Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button[role^="menuitem"]:not(:disabled)') ?? []);
  }
  useEffect(() => {
    if (disabled && open) close();
  }, [disabled, open]);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const anchor = button.current?.getBoundingClientRect();
      const panel = menu.current;
      if (!anchor || !panel) return;
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth);
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight);
      if (anchor.bottom <= topEdge || anchor.top >= bottomEdge || anchor.right <= leftEdge || anchor.left >= rightEdge) {
        close();
        return;
      }
      const width = Math.min(300, rightEdge - leftEdge - 16);
      const above = Math.max(0, anchor.top - topEdge - 14);
      const below = Math.max(0, bottomEdge - anchor.bottom - 14);
      const upward = above >= Math.min(panel.scrollHeight, 300) || above >= below;
      const maxHeight = Math.min(360, upward ? above : below);
      const height = Math.min(panel.scrollHeight, maxHeight);
      setPosition({ left: Math.max(leftEdge + 8, Math.min(anchor.left, rightEdge - width - 8)),
        top: upward ? anchor.top - height - 6 : anchor.bottom + 6, width, maxHeight });
    }
    place();
    const rows = items();
    ((last.current ? rows.at(-1) : rows[0]) ?? menu.current)?.focus();
    const observer = new ResizeObserver(place);
    if (button.current) observer.observe(button.current);
    if (menu.current) observer.observe(menu.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    // Catalog refresh may remove or disable the focused option while this menu stays open.
    const focused = document.activeElement;
    if (focused === document.body || (focused instanceof HTMLButtonElement && focused.disabled && menu.current?.contains(focused))) {
      items()[0]?.focus();
    }
  }, [open, children]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !button.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const panel = <div id={id} ref={menu} role={informational ? "dialog" : "menu"} tabIndex={-1} aria-label={label} hidden={!open}
    className="assistant-composer-menu" style={open ? position : undefined}
    onClick={(event) => {
      if (event.target instanceof Element && event.target.closest('button[role^="menuitem"]:not(:disabled)')) close(true);
    }}
    onKeyDown={(event) => {
      if (event.key === "Tab") { close(true); return; }
      const rows = items();
      const index = rows.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 :
        event.key === "ArrowDown" ? (index + 1) % rows.length : event.key === "ArrowUp" ? (index - 1 + rows.length) % rows.length : null;
      if (next !== null) { event.preventDefault(); rows[next]?.focus(); }
    }}>{children}</div>;
  return <div className={className}>
    <button type="button" ref={button} disabled={disabled} aria-label={label} title={title}
      aria-haspopup={informational ? "dialog" : "menu"} aria-expanded={open} aria-controls={id}
      onClick={() => { if (!open) { last.current = false; onOpen?.(); } setOpen(!open); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); last.current = event.key === "ArrowUp";
          if (!open) onOpen?.();
          setOpen(true);
        }
      }}>{trigger}</button>
    {open ? createPortal(panel, document.body) : panel}
  </div>;
}
