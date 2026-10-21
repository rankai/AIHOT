// Explicit maintenance command; no dotenv loading or provider requests.
import { migrateNativeSources } from "@aihot/backend/sources/native-migration";
import { closeDb } from "@aihot/backend/db";

export function migrationArguments(args: string[]): { oldWritersStopped: true; sourceIds?: string[] } {
  let stopped = false;
  const sourceIds: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--old-writers-stopped" && !stopped) stopped = true;
    else if (arg === "--source") {
      const id = args[++i];
      if (!id?.trim() || id.startsWith("--")) throw new Error("--source requires a non-empty source ID");
      sourceIds.push(id);
    } else throw new Error(`Unknown or repeated argument: ${arg}`);
  }
  if (!stopped) throw new Error("Confirm old API/worker writers have stopped with --old-writers-stopped");
  return { oldWritersStopped: true, ...(sourceIds.length ? { sourceIds: [...new Set(sourceIds)] } : {}) };
}

if (import.meta.main) {
  try { console.log(await migrateNativeSources(migrationArguments(process.argv.slice(2)))); }
  finally { await closeDb(); }
}
