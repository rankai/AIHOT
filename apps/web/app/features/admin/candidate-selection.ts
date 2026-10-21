// A binding choice is usable only in the completed candidate page currently shown for its kind.
export function candidateSelectionValid(sourceId: string, requestState: string, currentKind: string, resultKind: string, rows: readonly { id: string }[] | null | undefined): boolean {
  return requestState === "idle" && currentKind === resultKind && !!sourceId && !!rows?.some(row => row.id === sourceId);
}
