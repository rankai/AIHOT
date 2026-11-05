import type { AssistantSource } from "@aihot/contracts/assistant";

/** Resolve only supplied, usable evidence; repeated references to one work share one sample. */
export function selectResearchSamples(references: string[], available: Map<string, string | null>) {
  const works = new Map<string, string>(), aliases = new Map<string, string>();
  for (const id of references) if (available.has(id)) {
    const work = available.get(id) || id;
    const selected = works.get(work) ?? id;
    works.set(work, selected); aliases.set(id, selected);
  }
  return { sampleIds: [...works.values()], normalize: (ids: string[]) => [...new Set(ids.flatMap((id) => aliases.has(id) ? [aliases.get(id)!] : []))] };
}

/** Call only after the analysis and exact current/inherited version have been authorized. */
export function researchCitations<T extends { sourceId: string; title: string; url?: string | null }>(
  samples: T[], contentSources: string[], sources: AssistantSource[], analysisCallId: string, explanation: string,
) {
  const sampleIds = new Set(samples.map((sample) => sample.sourceId));
  const available = new Map(sources.map((source) => [source.id, source]));
  const requested = contentSources.filter((id) => available.get(id)?.kind !== "research" || sampleIds.has(id));
  const explicit = samples.filter((sample) => requested.includes(sample.sourceId));
  const cited = explicit.length ? explicit : samples.slice(0, 2);
  const snapshot = new Map(sources.filter((source) => requested.includes(source.id)).map((source) => [source.id, source]));
  for (const sample of cited) snapshot.set(sample.sourceId, {
    ...(snapshot.get(sample.sourceId) ?? { id: sample.sourceId, kind: "research" as const, label: sample.title, url: sample.url ?? null }),
    research: { analysisCallId, application: { explanation } },
  });
  return { cited, sourceIds: [...new Set([...requested, ...cited.map((sample) => sample.sourceId)])], sources: [...snapshot.values()] };
}
