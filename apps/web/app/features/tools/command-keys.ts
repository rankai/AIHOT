/** Optional private command scopes survive a route remount, without browser persistence. */
const scopes = new Map<string, { keys: Map<string, string>; touched: number }>();
const MAX_SCOPES = 32;
const MAX_KEYS = 16;
const RETENTION_MS = 24 * 60 * 60 * 1000;
export function scopedCommandKeys(csrf: string, scope: string, now = Date.now()): Map<string, string> {
  for (const [key, value] of scopes) if (now - value.touched > RETENTION_MS) scopes.delete(key);
  const identity = JSON.stringify([csrf, scope]);
  const previous = scopes.get(identity);
  scopes.delete(identity);
  const entry = previous ?? { keys: new Map<string, string>(), touched: now };
  entry.touched = now;
  scopes.set(identity, entry);
  while (scopes.size > MAX_SCOPES) scopes.delete(scopes.keys().next().value!);
  return entry.keys;
}
export function limitCommandKeys(keys: Map<string, string>) {
  while (keys.size > MAX_KEYS) keys.delete(keys.keys().next().value!);
}
