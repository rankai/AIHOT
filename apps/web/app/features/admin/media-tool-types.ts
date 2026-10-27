export type MediaToolGroup = "media" | "subtitle" | "text-check";
export interface MediaToolSpec {
  group: MediaToolGroup;
  purpose: "media" | "transcript" | "query";
  estimatedCny: number;
  inputName: "url" | "content";
}
export interface MediaToolLink { label: string; reportedValue: unknown; resourceValue: unknown; url: string | null }
