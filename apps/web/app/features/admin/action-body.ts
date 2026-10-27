// File identity distinguishes separate selections without reading binary content into a fingerprint.
const files = new WeakMap<Blob, number>();
let fileSequence = 0;
export function prepareAdminBody(value: unknown): { body: BodyInit | undefined; fingerprint: string | undefined; json: boolean } {
  if (value instanceof FormData) {
    const entries = [...value.entries()].map(([name, entry]) => {
      if (typeof entry === "string") return [name, "text", entry];
      let id = files.get(entry);
      if (id === undefined) { id = ++fileSequence; files.set(entry, id); }
      return [name, "file", id];
    });
    return { body: value, fingerprint: JSON.stringify(entries), json: false };
  }
  const body = value === undefined ? undefined : JSON.stringify(value);
  return { body, fingerprint: body, json: body !== undefined };
}
