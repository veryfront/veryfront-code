export function formatGeneratedModuleEntries(entries: string[]): string {
  return entries.length > 0 ? `${entries.join(",\n")},` : "";
}
