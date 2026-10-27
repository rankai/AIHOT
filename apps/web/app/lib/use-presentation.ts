import { useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "../root";
import { DEFAULT_SITE_PRESENTATION } from "./presentation";

export function usePresentation() {
  return useRouteLoaderData<typeof rootLoader>("root")?.presentation ?? DEFAULT_SITE_PRESENTATION;
}
