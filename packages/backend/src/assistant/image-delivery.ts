import { randomUUID } from "node:crypto";
import type { Tx } from "../db.ts";
import { conflict, event } from "./store.ts";
import { ImageProposal, activation } from "./tools.ts";
/** A completed provider response is not a deliverable until its owned local asset exists. */
export async function deliverImage(tx:Tx, turn:Record<string,any>, call:Record<string,any>) {
  const input = ImageProposal.parse(call.input);
  const { a, module } = await activation(tx,turn,input.activationId);
  if (!module.tools.includes("generate_image") || !module.outputKinds.includes("image")) throw conflict("当前模块不能交付图片");
  await tx`SELECT id FROM assistant_sessions WHERE id=${turn.session_id} FOR UPDATE`;
  const rows = await tx`SELECT z.id,z.file_key,f.metadata,r.input->'parameters' AS parameters FROM operation_results z
    JOIN operation_runs r ON r.id=z.run_id JOIN stored_files f ON f.key=z.file_key
    WHERE z.run_id=${call.child_run_id} AND z.kind='image' AND r.status='completed'
      AND r.actor=${`user:${turn.owner_user_id}`} AND r.input->>'assistantParentTurnId'=${turn.id}
      AND f.status='available' AND f.content_type LIKE 'image/%'`;
  if (rows.length !== 1 || !Number.isSafeInteger(rows[0]!.metadata.width) || !Number.isSafeInteger(rows[0]!.metadata.height))
    throw conflict("图片尚未保存到本地，请核对原任务");
  const row=rows[0]!;
  const [existing]=await tx`SELECT artifact_id,version FROM assistant_artifact_versions WHERE turn_id=${turn.id} AND activation_id=${a.id} AND kind='image' AND content->>'resultId'=${String(row.id)}`;
  if(existing) return {artifactId:existing.artifact_id,version:existing.version,kind:"image"};
  const artifactId=randomUUID();
  // Common display fields retain the existing artifact reader contract; only safe image metadata is added.
  const content={title:input.title,body:"",intent:"draft",titles:[],tags:[],sources:[],partial:false,scope:"单张1K图片",
    prompt:row.parameters.prompt,...(input.planReference?{planReference:input.planReference}:{}),resultId:row.id,fileKey:row.file_key,width:row.metadata.width,height:row.metadata.height};
  await tx`INSERT INTO assistant_artifact_versions(session_id,artifact_id,version,base_version,kind,turn_id,activation_id,content,source_snapshot)
    VALUES (${turn.session_id},${artifactId},1,0,'image',${turn.id},${a.id},${tx.json(content)},'[]'::jsonb)`;
  await event(tx,turn.session_id,"artifact",artifactId);
  return {artifactId,version:1,kind:"image"};
}
