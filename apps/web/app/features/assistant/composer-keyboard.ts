/** Touch keyboards keep Enter as a newline; IME confirmation never sends a request. */
export function sendsOnEnter(event: { key: string; shiftKey: boolean; keyCode: number; isComposing: boolean }, composing: boolean, coarsePointer: boolean): boolean {
  return event.key === "Enter" && !event.shiftKey && event.keyCode !== 229 && !event.isComposing && !composing && !coarsePointer;
}
