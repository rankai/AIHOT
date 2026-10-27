import { presentationFromMatches } from "../lib/presentation";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/all";
import { loadPool } from "../features/feed/pool.server";
import { PoolPage } from "../features/feed/PoolPage";
import { poolPageMeta } from "../features/feed/pool-meta";
export { headers } from "../features/feed/pool-meta";

export async function loader({ request }: Route.LoaderArgs) {
  return loadPool(request);
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  return poolPageMeta(loaderData?.data, "/all", presentationFromMatches(matches));
}

export default function AllPage() {
  const { data } = useLoaderData<typeof loader>();
  return <PoolPage data={data} base="/all" />;
}
