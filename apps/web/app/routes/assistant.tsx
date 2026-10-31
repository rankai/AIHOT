import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { SITE } from "@aihot/industry/site";
import { ACCOUNT_HEADERS } from "../features/account/data";
import { AssistantEntry } from "../features/assistant/page";
import { loadAssistantEntry } from "../features/assistant/entry.server";
export async function loader({ request }: LoaderFunctionArgs) {
  return loadAssistantEntry(request);
}
export const headers = () => ACCOUNT_HEADERS;
export const meta = () => [
  { title: `创作助手 · ${SITE.name}` },
  { name: "robots", content: "noindex, nofollow" },
];
export default function Assistant() {
  return (
    <AssistantEntry
      data={useLoaderData<typeof loader>()}
      assistantId="creative"
    />
  );
}
