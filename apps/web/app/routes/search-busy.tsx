import { titled } from "../lib/seo";
import { useLocation, useParams } from "react-router";
import { SearchBusy } from "../features/feed/SearchBusy";

export function meta() {
  return [{ title: titled("搜索繁忙") }, { name: "robots", content: "noindex, follow" }];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export default function SearchBusyPage() {
  const { pathname, search } = useLocation();
  const { id } = useParams();
  return <SearchBusy base={id && pathname.startsWith("/columns/") ? `/columns/${id}` : pathname.startsWith("/videos") ? "/videos" : "/all"} search={search} />;
}
