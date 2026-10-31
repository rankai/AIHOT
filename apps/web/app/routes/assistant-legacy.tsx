import { redirect, type LoaderFunctionArgs } from "react-router";
import { ACCOUNT_HEADERS } from "../features/account/data";

/** Old bookmarks only navigate. They never proxy or replay a business command. */
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return redirect(
    url.pathname.replace(/^\/tools\/assistant(?=\/|$)/, "/assistant") +
      url.search,
    { status: 302, headers: ACCOUNT_HEADERS },
  );
}
export const headers = () => ACCOUNT_HEADERS;
