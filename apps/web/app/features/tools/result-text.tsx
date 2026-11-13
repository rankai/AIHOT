import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "../admin/ui";
import { parseResultInline, parseResultText } from "./result-text-data";

/** Provider text stays React text; display and export share the same finite parser. */
function InlineText({ text }: { text: string }) {
  return parseResultInline(text).map((token, index) => token.kind === "strong" ? <strong key={index} className="font-semibold text-ink">{token.text}</strong> :
    token.kind === "code" ? <code key={index} className="rounded-mark bg-bg-sunk px-1 py-0.5 text-[0.92em]">{token.text}</code> :
    token.kind === "link" ? <a key={index} href={token.href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">{token.text}</a> : <Fragment key={index}>{token.text}</Fragment>);
}

export function ResultText({ text }: { text: string }) {
  const blocks = parseResultText(text).map((block, key) => {
    if (block.kind === "code") return <pre key={key} className="overflow-x-auto rounded-control bg-bg-sunk p-3 text-[12.5px] leading-6"><code>{block.text}</code></pre>;
    if (block.kind === "table") return <div key={key} className="overflow-x-auto rounded-control border border-line"><table className="w-full min-w-[400px] border-collapse text-left text-[13px]"><thead className="bg-bg-sunk"><tr>{block.headings.map((heading, index) => <th key={index} scope="col" className="border-b border-line px-3 py-2 font-medium text-ink"><InlineText text={heading} /></th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index}>{block.headings.map((_, column) => <td key={column} className="border-b border-line px-3 py-2 last:border-r-0"><InlineText text={row[column] ?? ""} /></td>)}</tr>)}</tbody></table></div>;
    if (block.kind === "heading") return <h3 key={key} className="pt-2 text-[16px] font-semibold text-ink"><InlineText text={block.text} /></h3>;
    if (block.kind === "list") {
      const items = block.items.map((item, index) => <li key={index}><InlineText text={item} /></li>);
      return block.ordered ? <ol key={key} start={block.start} className="list-decimal space-y-1 pl-5">{items}</ol> : <ul key={key} className="list-disc space-y-1 pl-5">{items}</ul>;
    }
    if (block.kind === "quote") return <blockquote key={key} className="border-l-2 border-line-strong pl-4 text-ink-3"><InlineText text={block.text} /></blockquote>;
    return <p key={key} className="whitespace-pre-wrap"><InlineText text={block.text} /></p>;
  });
  return <div className="min-w-0 space-y-4 break-words text-[14px] leading-7 text-ink-2 [overflow-wrap:anywhere]">{blocks}</div>;
}

export function ResultCopyButton({ text, label = "复制正文" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    setState("copying");
    try {
      try { await navigator.clipboard.writeText(text); }
      catch {
        const focused = document.activeElement, area = document.createElement("textarea");
        area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
        document.body.appendChild(area);
        try { area.select(); if (!document.execCommand("copy")) throw new Error("copy-failed"); }
        finally { area.remove(); if (focused instanceof HTMLElement) focused.focus({ preventScroll: true }); }
      }
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), 1800);
    } catch { setState("failed"); }
  }
  return <span className="flex flex-wrap items-center gap-2"><Button size="sm" busy={state === "copying"} onClick={copy}>{state === "copied" ? "已复制" : label}</Button><span role="status" className="text-[12px] text-ink-3">{state === "failed" ? "复制失败，请选择正文手动复制。" : state === "copied" ? "正文已复制" : ""}</span></span>;
}
