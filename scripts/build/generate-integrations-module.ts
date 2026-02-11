/**
 * Generates src/integrations/_data.ts from connector.json + SVG files.
 *
 * Usage:
 *   deno run -A scripts/build/generate-integrations-module.ts
 */

interface ConnectorJson {
  name: string;
  icon?: string;
  internal?: boolean;
  auth?: { callbackPath?: string; [key: string]: unknown };
  [key: string]: unknown;
}

const integrationsDir = "./cli/templates/integrations";
const dataPath = "./src/integrations/_data.ts";

const connectors: ConnectorJson[] = [];
const icons: [string, string][] = [];

for await (const entry of Deno.readDir(integrationsDir)) {
  if (!entry.isDirectory || entry.name === "_base") continue;

  const dirPath = `${integrationsDir}/${entry.name}`;

  try {
    const raw = await Deno.readTextFile(`${dirPath}/connector.json`);
    const connector: ConnectorJson = JSON.parse(raw);

    if (connector.internal) continue;

    if (connector.auth) {
      const { callbackPath: _, ...rest } = connector.auth;
      connector.auth = rest;
    }

    // Strip CLI-only fields
    delete connector.internal;
    delete connector.version;
    delete connector.SETUP_GUIDE;
    delete connector.setupGuide;

    connectors.push(connector);

    if (connector.icon) {
      try {
        const svg = await Deno.readTextFile(`${dirPath}/${connector.icon}`);
        icons.push([connector.name, svg]);
      } catch { /* no SVG */ }
    }
  } catch { /* no connector.json */ }
}

connectors.sort((a, b) => a.name.localeCompare(b.name));
icons.sort((a, b) => a[0].localeCompare(b[0]));

const connectorLines = connectors
  .map((c) => `  ${JSON.stringify(c)}`)
  .join(",\n");

const iconLines = icons
  .map(([name, svg]) => `  ${JSON.stringify(name)}: ${JSON.stringify(svg)}`)
  .join(",\n");

await Deno.writeTextFile(
  dataPath,
  `// Auto-generated — do not edit
import type { IntegrationConfig } from "./types.ts";

export const connectors: IntegrationConfig[] = [
${connectorLines},
];

export const icons: Record<string, string> = {
${iconLines},
};
`,
);

console.log(
  `\u2705 Generated ${dataPath} (${connectors.length} connectors, ${icons.length} icons)`,
);
