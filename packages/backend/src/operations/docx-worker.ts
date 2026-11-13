import { parentPort, workerData } from "node:worker_threads";
import yauzl from "yauzl";
import mammoth from "mammoth";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { load } from "cheerio";
const bytes = Buffer.from(workerData);
const xml = new Map<string, string>();
const names = new Set<string>();
const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
async function inspect() {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      let total = 0, declared = 0;
      const fail = (error: unknown) => { zip.close(); reject(error); };
      zip.on("error", fail); zip.on("end", resolve);
      zip.on("entry", (entry: yauzl.Entry) => {
        const name = entry.fileName;
        if (names.has(name) || names.size >= 1000 || name.includes("\\") || name.split("/").some(x => x === ".." || x === ".") || name.startsWith("/") || (entry.generalPurposeBitFlag & 1) || /vbaProject/i.test(name)) return fail(new Error("invalid"));
        names.add(name); declared += entry.uncompressedSize;
        const isXml = /\.(xml|rels)$/i.test(name);
        if (declared > 20 * 1024 * 1024 || (isXml && entry.uncompressedSize > 4 * 1024 * 1024)) return fail(new Error("invalid"));
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail(error);
          const chunks: Buffer[] = []; let size = 0;
          stream.on("error", fail);
          stream.on("data", (chunk: Buffer) => {
            size += chunk.length; total += chunk.length;
            if (total > 20 * 1024 * 1024 || size > entry.uncompressedSize || (isXml && size > 4 * 1024 * 1024)) { stream.destroy(); fail(new Error("invalid")); return; }
            if (isXml) chunks.push(chunk);
          });
          stream.on("end", () => {
            try {
              if (isXml) {
                const text = new TextDecoder("utf-8", {fatal:true}).decode(Buffer.concat(chunks));
                if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new Error("invalid");
                xml.set(name, text);
              }
              zip.readEntry();
            } catch (error) { fail(error); }
          });
        });
      });
      zip.readEntry();
    });
  });
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: false });
  const array = (value: any): any[] => value ? Array.isArray(value) ? value : [value] : [];
  const types = parser.parse(xml.get("[Content_Types].xml") ?? "").Types;
  const relationships = parser.parse(xml.get("_rels/.rels") ?? "").Relationships;
  if (!array(types?.Override).some(v => v["@_PartName"] === "/word/document.xml" && v["@_ContentType"] === "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") || !array(relationships?.Relationship).some(v => v["@_Type"] === "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" && ["word/document.xml", "/word/document.xml"].includes(v["@_Target"]) && v["@_TargetMode"] !== "External")) throw new Error("invalid");
  if ([...array(types?.Override), ...array(types?.Default)].some(v => /macroEnabled|vbaProject/i.test(String(v["@_ContentType"])))) throw new Error("invalid");
  for (const [name, value] of xml) if (name.endsWith(".rels") && array(parser.parse(value).Relationships?.Relationship).some(v => /vbaProject/i.test(String(v["@_Type"])))) throw new Error("invalid");
  const body = xml.get("word/document.xml");
  if (!body || !body.includes(wordNamespace)) throw new Error("invalid");
  // Namespace-independent inspection, including revisions in notes and table/property changes.
  for (const [name, text] of xml) if (name.startsWith("word/")) {
    const $ = load(text, {xml:true});
    if ($("*").toArray().some(node => /^(ins|del|moveFrom|moveTo|.*PrChange|cellIns|cellDel|cellMerge)$/.test(("name" in node ? node.name : "").split(":").pop()!))) throw new Error("revisions");
  }
}
try {
  await inspect();
  const result = await mammoth.convertToHtml({ buffer: bytes }, { includeEmbeddedStyleMap: false, includeDefaultStyleMap: true, externalFileAccess: false, convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
  const $ = load(result.value);
  $("a[href^='#footnote-ref'], a[href^='#endnote-ref']").remove();
  $("ol").filter((_, node) => $(node).find("[id^='footnote-'], [id^='endnote-']").length > 0).before("\n\n注释：\n");
  $("li").each((_, node) => {
    const item = $(node);
    // Mammoth renders footnotes/endnotes as a separate ordered list, already labelled above.
    if (/^(footnote|endnote)-/.test(item.attr("id") ?? "")) return;
    const depth = Math.max(0, item.parents("ul, ol").length - 1);
    const marker = item.parent().is("ol") ? `${item.prevAll("li").length + 1}.` : "•";
    item.prepend(`\n${"  ".repeat(depth)}${marker} `);
  });
  $("br").replaceWith("\n");
  $("p, h1, h2, h3, h4, h5, h6, li").append("\n");
  $("td, th").each((_, node) => { $(node).text($(node).text().trim().replace(/\n+/g, " / ") + "\t"); });
  $("tr").append("\n");
  const text = $("body").text().replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("empty");
  if (text.length > 30000) throw new Error("long");
  const omitted = [...names].some(n => /^word\/(media|embeddings|charts)\//.test(n)) || [...xml.values()].some(v => /<(?:\w+:)?(?:drawing|pict|object|oMath)\b/.test(v));
  parentPort!.postMessage({ text, warnings: omitted ? ["embedded_content_omitted"] : [] });
} catch (error) {
  const code = error instanceof Error && ["revisions", "empty", "long"].includes(error.message) ? error.message : "invalid";
  parentPort!.postMessage({ error: code });
}
