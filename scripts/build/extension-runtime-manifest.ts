/** Structured helpers for the runtime manifest module emitted by dnt. */

export function parseExtensionRuntimeManifestModule(
  source: string,
  path: string,
): Record<string, unknown> | null {
  const prefix = "export default ";
  const trimmed = source.trim();
  if (!trimmed.startsWith(prefix) || !trimmed.endsWith(";")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(prefix.length, -1));
  } catch (cause) {
    throw new Error(`Generated extension manifest module is invalid: ${path}`, {
      cause,
    });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Generated extension manifest module is invalid: ${path}`);
  }
  return parsed as Record<string, unknown>;
}

export function renderExtensionRuntimeManifestModule(
  manifest: object,
  version: string,
): string {
  return `export default ${
    JSON.stringify({ ...manifest, version }, null, 2)
  };\n`;
}
