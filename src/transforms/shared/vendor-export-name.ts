export function sanitizeVendorExportName(pkg: string): string {
  return pkg
    .replace(/^@/, "")
    .replace(/[/-]/g, "_")
    .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    .replace(/^_/, "");
}
