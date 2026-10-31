import type { AccountMe } from "@aihot/contracts/account";
import type { AssistantOptions } from "@aihot/contracts/assistant";
import { accountGet } from "../../lib/account.server";
import type { SessionPage } from "./data";

export async function loadAssistantEntry(request: Request) {
  const [me, options, history] = await Promise.all([
    accountGet<AccountMe>(request, "/api/account/me"),
    accountGet<AssistantOptions>(request, "/api/assistant/options"),
    accountGet<SessionPage>(request, "/api/assistant/sessions"),
  ]);
  return { me, options, history };
}
