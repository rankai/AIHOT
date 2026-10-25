import { CATEGORIES } from "./taxonomy.ts";

/** Array position is display order within each surface's existing navigation groups. */
export const DEFAULT_PRESENTATION = {
  navigation: [
    { id: "selected", visible: true },
    { id: "all", visible: true },
    { id: "videos", visible: false },
    { id: "hot", visible: true },
    { id: "daily", visible: true },
    { id: "topics", visible: true },
    { id: "starred", visible: true },
    { id: "leaderboard", visible: true },
    { id: "codexReset", visible: true },
    { id: "agent", visible: true },
    { id: "about", visible: true },
    { id: "changelog", visible: true },
    { id: "feedback", visible: true },
  ],
  categories: CATEGORIES.map(({ key }) => ({ id: key, visible: true })),
  pageSizes: { selected: 20, all: 40, videos: 20 },
} as const;
