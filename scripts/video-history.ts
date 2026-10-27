// Explicit database only. Never loads .env, fetches suppliers, or starts a queue.
import {readFile,writeFile,rename,unlink,open} from "node:fs/promises";
import {resolve,dirname} from "node:path";
const args=process.argv.slice(2),mode=args[0]?.startsWith("--")||!args[0]?"dry-run":args.shift()!;
if(!["dry-run","apply","restore"].includes(mode))throw new Error("Usage: video-history.ts [dry-run|apply|restore] --manifest PATH [--limit 500] [--after ARTICLE_ID]");
const options=new Map<string,string>();
while(args.length){const name=args.shift()!,value=args.shift();if(!["--manifest","--limit","--after"].includes(name)||!value||options.has(name))throw new Error("Invalid arguments");options.set(name,value);}
if(!options.has("--manifest"))throw new Error("--manifest is required");
if(!process.env.DATABASE_URL)throw new Error("Explicit DATABASE_URL is required; no default business database is allowed");
const target=new URL(process.env.DATABASE_URL),database=decodeURIComponent(target.pathname.slice(1));
if(!["postgres:","postgresql:"].includes(target.protocol)||!database)throw new Error("Invalid explicit DATABASE_URL");
for(const key of ["COLLECT_ENABLED","MODEL_CALLS_ENABLED","REDFOX_CALLS_ENABLED","FEISHU_INTERNAL_ENABLED","FEISHU_CONTENT_PUSH_ENABLED","INDEXNOW_SUBMIT_ENABLED"])process.env[key]="false";
const {sql,closeDb}=await import("@aihot/backend/db");
const {VideoHistoryManifest,scanVideoHistory,applyVideoHistoryEntry,restoreVideoHistoryEntry,reconcileVideoHistoryEntry}=await import("@aihot/backend/content/video-history");
const path=resolve(options.get("--manifest")!),temporary=`${path}.${process.pid}.tmp`;
try{
 const [connected]=await sql`SELECT current_database() AS name`;
 if(connected!.name!==database)throw new Error("Connected database differs from explicit target");
 if(mode==="dry-run"){
  const manifest=await sql.begin("read only",tx=>scanVideoHistory(tx,Number(options.get("--limit")??500),options.get("--after")));
  await writeFile(path,JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
  console.log(JSON.stringify({mode,planned:manifest.entries.length,nextCursor:manifest.nextCursor,skipped:manifest.skipped}));
 }else{
  if(options.has("--limit")||options.has("--after"))throw new Error("--limit and --after apply only to dry-run");
  const manifest=VideoHistoryManifest.parse(JSON.parse(await readFile(path,"utf8")));
  if(manifest.database!==database)throw new Error("Manifest database differs from explicit target");
  const skipped:Record<string,number>={};let changed=0;
  // Save the recovery record before committing. If the commit fails, restore still
  // requires the exact after snapshot and cannot alter a row that was rolled back.
  await sql.begin(async tx=>{
   for(let i=0;i<manifest.entries.length;i++){
    try{manifest.entries[i]=await tx.savepoint(async t=>{
     const entry=await reconcileVideoHistoryEntry(t,manifest.entries[i]!);
     if(entry.status!==(mode==="apply"?"planned":"applied"))return entry;
     const updated=await (mode==="apply"?applyVideoHistoryEntry(t,entry):restoreVideoHistoryEntry(t,entry));changed++;return updated;
    });}
    catch(error){const message=error instanceof Error?error.message:"invalid-evidence",reason=/^[a-z-]+$/.test(message)?message:"invalid-evidence";skipped[reason]=(skipped[reason]??0)+1;}
   }
   const file=await open(temporary,"wx",0o600);
   try{await file.writeFile(JSON.stringify(manifest,null,2)+"\n");await file.sync();}finally{await file.close();}
   await rename(temporary,path);
   const directory=await open(dirname(path),"r");try{await directory.sync();}finally{await directory.close();}
  });
  console.log(JSON.stringify({mode,changed,skipped}));
 }
}finally{await unlink(temporary).catch(()=>{});await closeDb();}
