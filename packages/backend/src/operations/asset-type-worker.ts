import { parentPort, workerData } from "node:worker_threads";
import { fileTypeFromBuffer } from "file-type";
try {
  const detected = await fileTypeFromBuffer(new Uint8Array(workerData), { maxBufferSize: 128 * 1024, signal: AbortSignal.timeout(1500) });
  parentPort!.postMessage({ detected: detected ?? null });
} catch { parentPort!.postMessage({ error: "Unrecognized or malformed media header" }); }
