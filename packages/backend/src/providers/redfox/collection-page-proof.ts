import { z } from "zod";
import type { Db } from '../../db.ts';
import { UnsupportedReplacement } from '../../sources/x-replacement.ts';
/** Same-receipt platform collection items use the committed page as their discovery fact.
 * Weibo detail enrichment has a different receipt and keeps its specific validation. */
export async function collectionDiscoveredAt(tx:Db,raw:Record<string,unknown>,platform:string,operation:string):Promise<Date>{
  const snapshot=z.object({operation_key:z.string(),run_id:z.number(),receipt_id:z.number(),created_at:z.union([z.date(),z.string()]),input:z.record(z.string(),z.unknown()),provenance:z.record(z.string(),z.unknown()).optional()}).parse(raw);
  if(snapshot.operation_key!=="redfox.platform.collection")return new Date(snapshot.created_at);
  const pageId=snapshot.provenance?.sourcePageResultId;
  if(snapshot.input.platform!==platform||snapshot.input.operationId!==operation||!Number.isSafeInteger(pageId)||Number(pageId)<=0)throw new UnsupportedReplacement("Invalid collection page evidence");
  const [page]=await tx`SELECT z.created_at FROM operation_results z JOIN receipts p ON p.id=z.receipt_id
    WHERE z.id=${Number(pageId)} AND z.run_id=${snapshot.run_id} AND z.receipt_id=${snapshot.receipt_id}
    AND z.kind='query_summary' AND z.data->>'platform'=${platform} AND z.data->>'operationId'=${operation}
    AND z.item_key='page:'||(z.data->>'page') AND p.model=${operation} AND p.status IN ('received','completed')`;
  if(!page)throw new UnsupportedReplacement("Source page does not verify this collection result");
  return new Date(page.created_at);
}
