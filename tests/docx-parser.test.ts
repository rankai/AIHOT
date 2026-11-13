import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {inspectDocx, DOCX_BYTES} from "@aihot/backend/operations/docx";
import {docxFixture,docxEntries,zipFixture,paragraph} from "./docx-fixture.ts";
async function parse(bytes: Buffer) {
 const dir=await mkdtemp(join(tmpdir(),"aihot-docx-parser-")), file=join(dir,"fixture.docx");
 try { await writeFile(file,bytes); return await inspectDocx(file,createHash("sha256").update(bytes).digest("hex")); }
 finally { await rm(dir,{recursive:true,force:true}); }
}
test("DOCX preserves text, line breaks and table cells, ignores embedded content and never follows external relationships", async()=>{
 const body=paragraph("标题 English 中文 macroEnabled vbaProject")+'<w:p><w:r><w:t>第一行</w:t><w:br/><w:t>第二行</w:t></w:r></w:p><w:tbl><w:tr><w:tc>'+paragraph("甲")+'</w:tc><w:tc>'+paragraph("乙")+'</w:tc></w:tr><w:tr><w:tc>'+paragraph("丙")+'</w:tc><w:tc>'+paragraph("丁")+'</w:tc></w:tr></w:tbl><w:p><w:hyperlink r:id="link"><w:r><w:t>链接文字</w:t></w:r></w:hyperlink></w:p>';
 const result=await parse(docxFixture(body,[["word/_rels/document.xml.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="http://127.0.0.1:1/never-fetch" TargetMode="External"/></Relationships>'],["word/media/image.png",Buffer.from("unread image")],["word/printerSettings/printerSettings1.bin",Buffer.from("ignored")]]));
 assert.equal(result.metadata.extraction.text,"标题 English 中文 macroEnabled vbaProject\n第一行\n第二行\n甲\t乙\n丙\t丁\n链接文字");
 assert.deepEqual(result.metadata.extraction.warnings,["embedded_content_omitted"]);
});
test("DOCX rejects malformed, empty, revised, too long, excessive ZIP expansion, duplicate and unsafe XML packages",async()=>{
 const base=docxEntries(paragraph("hello"));
 for(const bytes of [Buffer.from("not zip"),docxFixture(""),docxFixture('<w:ins>'+paragraph("pending")+'</w:ins>'),docxFixture(paragraph("x".repeat(30001))),zipFixture([...base,["word/document.xml",base[2]![1]]]),zipFixture([...base,["../escape", "bad"]]),zipFixture([...base,["word/large.xml"," ".repeat(4*1024*1024+1)]]),zipFixture([...base,["word/unsafe.xml",'<!DOCTYPE x [<!ENTITY x SYSTEM "file:///never-read">]><x>&x;</x>']]),zipFixture([...base,["word/vbaProject.bin",Buffer.from("macro")]]),docxFixture(paragraph("valid"),[["word/embeddings/large.bin",Buffer.alloc(20*1024*1024)]])]) await assert.rejects(parse(bytes), (e:any)=>[413,422].includes(e.statusCode));
 await assert.rejects(parse(Buffer.alloc(DOCX_BYTES+1)),{statusCode:413});
});
test("DOCX places footnotes and endnotes after body with a separator and preserves ordinary lists",async()=>{
 const body='<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>'+paragraph("正文")+'<w:p><w:r><w:t>引用</w:t><w:footnoteReference w:id="1"/><w:endnoteReference w:id="2"/></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>列表项</w:t></w:r></w:p>';
 const nested='<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>二级列表项</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>下一项</w:t></w:r></w:p>';
 const rels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+['footnotes','endnotes','numbering'].map((n,i)=>`<Relationship Id="r${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${n}" Target="${n}.xml"/>`).join('')+'</Relationships>';
 const result=await parse(docxFixture(body+nested,[["word/_rels/document.xml.rels",rels],["word/footnotes.xml",'<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1">'+paragraph("脚注文字")+'</w:footnote></w:footnotes>'],["word/endnotes.xml",'<w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:endnote w:id="2">'+paragraph("尾注文字")+'</w:endnote></w:endnotes>'],["word/numbering.xml",'<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>']]));
 const text=result.metadata.extraction.text;
 assert.match(text,/• 列表项\n  1\. 二级列表项\n(?:\n)?• 下一项/);
 assert.match(text,/标题\n正文\n引用/); assert(text.indexOf('列表项')<text.indexOf('注释：')); assert(text.indexOf('注释：')<text.indexOf('脚注文字')); assert(text.indexOf('脚注文字')<text.indexOf('尾注文字'));
});
test("DOCX worker deadline terminates parsing and returns only the retryable message",async(t)=>{
 t.mock.timers.enable({apis:["setTimeout"]});
 let complete=false;
 const pending=parse(docxFixture(paragraph("deadline fixture")));
 const checked=assert.rejects(pending,{statusCode:503,message:"这份文件暂时没读好，可以重试；其他材料已保留。"}).finally(()=>{complete=true;});
 for(let i=0;i<10000&&!complete;i++){await new Promise<void>(resolve=>setImmediate(resolve));t.mock.timers.tick(5001);}
 await checked;
});
test("DOCX rejects too many entries and encrypted ZIP flags",async()=>{
 await assert.rejects(parse(zipFixture([...docxEntries(paragraph("valid")),...Array.from({length:998},(_,i):[string,string]=>[`parts/${i}`,""])])),{statusCode:422});
 const encrypted=docxFixture(paragraph("valid"));
 encrypted.writeUInt16LE(1,6);
 const central=encrypted.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));encrypted.writeUInt16LE(1,central+8);
 await assert.rejects(parse(encrypted),{statusCode:422});
});
