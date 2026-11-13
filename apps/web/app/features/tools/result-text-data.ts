import { safeExternalUrl } from "../admin/platform-types.ts";

export type ResultInline = { kind: "text" | "strong" | "code"; text: string } | { kind: "link"; text: string; href: string; address: string };
export type ResultBlock =
  | { kind: "code" | "heading" | "quote" | "paragraph"; text: string }
  | { kind: "table"; headings: string[]; rows: string[][] }
  | { kind: "list"; ordered: boolean; start: number; items: string[] };

/** Deliberately finite Markdown interpretation, shared by display and readable export. */
export function parseResultInline(text: string): ResultInline[] {
  const output: ResultInline[] = [];
  const tokens = /\[[^\]\n]+\]\([^)\n]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`/g;
  let start = 0;
  for (const match of text.matchAll(tokens)) {
    const index = match.index!, token = match[0];
    output.push({ kind: "text", text: text.slice(start, index) });
    if (token.startsWith("**")) output.push({ kind: "strong", text: token.slice(2, -2) });
    else if (token.startsWith("`")) output.push({ kind: "code", text: token.slice(1, -1) });
    else {
      const split = token.indexOf("]("), address = token.slice(split + 2, -1), href = safeExternalUrl(address);
      output.push(href ? { kind: "link", text: token.slice(1, split), href, address } : { kind: "text", text: token });
    }
    start = index + token.length;
  }
  output.push({ kind: "text", text: text.slice(start) });
  return output;
}

export function parseResultText(text: string): ResultBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n"), blocks: ResultBlock[] = [];
  const tableCells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const code: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i++]!);
      if (i < lines.length) i++;
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && tableCells(lines[i + 1]!).every(cell => /^:?-{3,}:?$/.test(cell))) {
      const headings = tableCells(line), rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) rows.push(tableCells(lines[i++]!));
      blocks.push({ kind: "table", headings, rows }); continue;
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) { blocks.push({ kind: "heading", text: heading[1]! }); i++; continue; }
    if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)\S/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line), items: string[] = [];
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (i < lines.length) { const item = pattern.exec(lines[i]!); if (!item) break; items.push(item[1]!); i++; }
      blocks.push({ kind: "list", ordered, start: Number(/^\s*(\d+)/.exec(line)?.[1] ?? 1), items }); continue;
    }
    if (/^>\s?/.test(line)) { blocks.push({ kind: "quote", text: line.replace(/^>\s?/, "") }); i++; continue; }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i]!.trim() && !/^\s*(?:```|#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(lines[i]!)) paragraph.push(lines[i++]!);
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

function inlinePlainText(text: string) {
  return parseResultInline(text).map(token => token.kind === "link" && token.text !== token.address ? `${token.text} (${token.address})` : token.text).join("");
}
export function resultPlainText(text: string): string {
  return parseResultText(text).map(block => {
    if (block.kind === "code") return block.text;
    if (block.kind === "table") return [block.headings, ...block.rows].map(row => row.map(inlinePlainText).join(" | ")).join("\n");
    if (block.kind === "list") return block.items.map((item, index) => `${block.ordered ? `${block.start + index}.` : "•"} ${inlinePlainText(item)}`).join("\n");
    return inlinePlainText(block.text);
  }).join("\n\n");
}
