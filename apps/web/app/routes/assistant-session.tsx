import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { AccountMe } from "@aihot/contracts/account";
import type {
  AssistantOptions,
  AssistantSession,
} from "@aihot/contracts/assistant";
import { SITE } from "@aihot/industry/site";
import { accountGet } from "../lib/account.server";
import { ACCOUNT_HEADERS } from "../features/account/data";
import type { SessionPage } from "../features/assistant/data";
import { AssistantConversation } from "../features/assistant/conversation";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const [me, options, history, session] = await Promise.all([
    accountGet<AccountMe>(request, "/api/account/me"),
    accountGet<AssistantOptions>(request, "/api/assistant/options"),
    accountGet<SessionPage>(request, "/api/assistant/sessions"),
    accountGet<AssistantSession>(
      request,
      `/api/assistant/sessions/${encodeURIComponent(params.sessionId ?? "")}`,
    ),
  ]);
  return { me, options, session, history };
}
export const headers = () => ACCOUNT_HEADERS;
export const meta = () => [
  { title: `创作会话 · ${SITE.name}` },
  { name: "robots", content: "noindex, nofollow" },
];
export default function AssistantSessionRoute() {
  return <AssistantConversation data={useLoaderData<typeof loader>()} />;
}
