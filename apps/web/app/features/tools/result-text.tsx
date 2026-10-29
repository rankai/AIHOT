import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../admin/ui";
import { safeExternalUrl } from "../admin/platform-types";

/** Provider text is always React text. Only a small set of Markdown syntax is interpreted. */
function InlineText({ text }: { text: string }) {
  const output: ReactNode[] = [];
  const tokens = /\[[^\]\n]+\]\([^)\n]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`/g;
  let start = 0;
  for (const match of text.matchAll(tokens)) {
    const index = match.index!, token = match[0];
    output.push(text.slice(start, index));
    if (token.startsWith("**")) output.push(<strong key={index} className="font-semibold text-ink">{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) output.push(<code key={index} className="rounded-mark bg-bg-sunk px-1 py-0.5 text-[0.92em]">{token.slice(1, -1)}</code>);
    else {
      const split = token.indexOf("]("), label = token.slice(1, split), href = safeExternalUrl(token.slice(split + 2, -1));
      output.push(href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">{label}</a> : <Fragment key={index}>{token}</Fragment>);
    }
    start = index + token.length;
  }
  output.push(text.slice(start));
  return output;
}

export function ResultText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n"), blocks: ReactNode[] = [];
  const tableCells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!, key = i;
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const code: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i++]!);
      if (i < lines.length) i++;
      blocks.push(<pre key={key} className="overflow-x-auto rounded-control bg-bg-sunk p-3 text-[12.5px] leading-6"><code>{code.join("\n")}</code></pre>);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && tableCells(lines[i + 1]!).every(cell => /^:?-{3,}:?$/.test(cell))) {
      const headings = tableCells(line), rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) rows.push(tableCells(lines[i++]!));
      blocks.push(<div key={key} className="overflow-x-auto rounded-control border border-line"><table className="w-full min-w-[400px] border-collapse text-left text-[13px]"><thead className="bg-bg-sunk"><tr>{headings.map((heading, index) => <th key={index} scope="col" className="border-b border-line px-3 py-2 font-medium text-ink"><InlineText text={heading} /></th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{headings.map((_, column) => <td key={column} className="border-b border-line px-3 py-2 last:border-r-0"><InlineText text={row[column] ?? ""} /></td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) { blocks.push(<h3 key={key} className="pt-2 text-[16px] font-semibold text-ink"><InlineText text={heading[1]!} /></h3>); i++; continue; }
    if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)\S/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line), items: ReactNode[] = [];
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (i < lines.length) { const item = pattern.exec(lines[i]!); if (!item) break; items.push(<li key={i}><InlineText text={item[1]!} /></li>); i++; }
      const start = ordered ? Number(/^\s*(\d+)/.exec(line)?.[1] ?? 1) : undefined;
      blocks.push(ordered ? <ol key={key} start={start} className="list-decimal space-y-1 pl-5">{items}</ol> : <ul key={key} className="list-disc space-y-1 pl-5">{items}</ul>);
      continue;
    }
    if (/^>\s?/.test(line)) { blocks.push(<blockquote key={key} className="border-l-2 border-line-strong pl-4 text-ink-3"><InlineText text={line.replace(/^>\s?/, "")} /></blockquote>); i++; continue; }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i]!.trim() && !/^\s*(?:```|#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(lines[i]!)) paragraph.push(lines[i++]!);
    blocks.push(<p key={key} className="whitespace-pre-wrap"><InlineText text={paragraph.join("\n")} /></p>);
  }
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
