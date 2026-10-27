// Native MP scheduling retains the existing 15-minute cron scan and per-subscription interval.
import { scheduleNativeCollections } from "./native-scheduling.ts";
export async function scheduleMpReconcile(now = new Date()) {
  return scheduleNativeCollections("mp_account", now);
}
