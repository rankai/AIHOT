// Native X/MP creates an asynchronous operation; other source kinds collect immediately.
// node --env-file=.env scripts/collect.ts rss-openai-news x-example ...
import { randomUUID } from "node:crypto";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { collectSource } from "@aihot/backend/sources/collect";
import { createCollection } from "@aihot/backend/sources/collection-commands";

export async function collectRequestedSource(id: string) {
  const [source] = await sql`SELECT kind FROM sources WHERE id = ${id}`;
  if (!source) throw new Error(`Source not found: ${id}`);
  if (["x_search", "mp_account"].includes(source.kind)) {
    const run = await createCollection(id, { actor: "cli", key: randomUUID(), reason: "manual", force: true });
    return { sourceId: id, runId: run.id, status: run.status };
  }
  return collectSource(id, { force: true });
}

if (import.meta.main) {
  try {
    const ids = process.argv.slice(2);
    if (!ids.length || ids.some(id => !id.trim() || id.startsWith("--"))) throw new Error("Provide one or more source IDs");
    for (const id of ids) {
      const started = Date.now();
      console.log(JSON.stringify({ ...await collectRequestedSource(id), ms: Date.now() - started }));
    }
  } finally { await stopBoss(); await closeDb(); }
}
