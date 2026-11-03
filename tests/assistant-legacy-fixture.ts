import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from '@aihot/backend/db';
import { candidates } from '@aihot/backend/assistant/catalog';
import { TurnInput, requireAvailable } from '@aihot/backend/assistant/config';
import { ownedSession, command } from '@aihot/backend/assistant/store';
import { snapshotInput, quoteAssistantTurn, submitTurnTx } from '@aihot/backend/assistant/sessions';

const entries=new Map<string,string>();
/** Simulate an accepted pre-task queue snapshot, never a current package with legacy charging. */
export async function quoteLegacyTurn(userId:number,sessionId:string,raw:unknown,versions:Record<string,string>){
 const input=TurnInput.parse(raw),session=await ownedSession(sql,userId,sessionId);
 await requireAvailable();
 const scope=await candidates(session.assistant_id,input.skillSelection,versions);
 if(scope.some(c=>!Object.hasOwn(versions,c.skillId)))throw new Error('Legacy fixtures require an explicit version for every admitted skill');
 const id=await sql.begin(async tx=>{
  const [existing]=await tx`SELECT id,admission_snapshot FROM assistant_message_queue WHERE session_id=${sessionId} AND command_key LIKE 'legacy-fixture:%' AND state IN ('pending','quoted') ORDER BY position LIMIT 1 FOR UPDATE`;
  if(existing){assert.deepEqual(existing.admission_snapshot.candidates,scope,"Pending historical scope must match the requested immutable versions");return existing.id as string;}
  const id=randomUUID(),c=command(`legacy-fixture:${id}`,input);
  await tx`INSERT INTO assistant_message_queue(id,session_id,command_key,command_hash,input,admission_snapshot) VALUES (${id},${sessionId},${c.key},${c.hash},${tx.json(input as never)},${tx.json({version:1,candidates:scope,policies:[],unavailableSkills:[]} as never)})`;
  return id;
 });
 const prepared=await snapshotInput(sql,userId,sessionId,input,id),quote=await quoteAssistantTurn(userId,prepared);
 if(quote.task)throw new Error('Legacy fixture selected a task billing package');
 entries.set(quote.quoteId,id);
 return quote;
}
export async function submitLegacyTurn(userId:number,sessionId:string,raw:any,key:unknown){
 const id=entries.get(raw.quoteId);
 if(!id)throw new Error('Missing historical accepted quote fixture');
 return sql.begin(async tx=>{
  const result=await submitTurnTx(tx,userId,sessionId,raw,key,id);
  await tx`UPDATE assistant_message_queue SET state='submitted',submitted_turn_id=${result.turnId} WHERE id=${id} AND session_id=${sessionId}`;
  return result;
 });
}
