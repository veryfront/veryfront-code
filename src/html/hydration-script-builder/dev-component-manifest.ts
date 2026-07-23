import type { VeryfrontConfig } from "#veryfront/config";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import { buildNonceAttribute } from "../html-escape.ts";
import { createHydrationJSONSnapshotter, snapshotPlainDataRecord } from "../json-snapshot.ts";

const MAX_DEV_COMPONENTS = 1_000;
const MAX_DEV_COMPONENT_MANIFEST_BYTES = 1024 * 1024;

export function generateDevComponentManifestScript(
  config: VeryfrontConfig,
  nonce?: string,
): string {
  const configSnapshot = snapshotPlainDataRecord(config, "Development component config");
  const devConfig = configSnapshot.dev === undefined
    ? undefined
    : snapshotPlainDataRecord(configSnapshot.dev, "Development component dev config");
  const nonceAttr = buildNonceAttribute(nonce);
  const components = createHydrationJSONSnapshotter().array(
    devConfig?.components ?? [],
    "Development components",
  );
  if (components.length > MAX_DEV_COMPONENTS) {
    throw new TypeError("Development component manifest exceeds the entry limit");
  }
  const serializedComponents = jsonForInlineScript(components);
  if (
    new TextEncoder().encode(serializedComponents).byteLength > MAX_DEV_COMPONENT_MANIFEST_BYTES
  ) {
    throw new TypeError("Development component manifest exceeds the size limit");
  }

  return `
  <script${nonceAttr}>
    window.__veryfrontComponents = ${serializedComponents};
  </script>`;
}
