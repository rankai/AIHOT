/** An explicit creation draft only; it neither creates nor binds an account. */
export function sourceNewPreset(template: string | null) {
  return template === "isolated-external" ? {
    form: { kind: "external", participation_mode: "isolated", first_party: false, site_fulltext: false, syndicate_fulltext: false },
    config: {},
  } : null;
}
