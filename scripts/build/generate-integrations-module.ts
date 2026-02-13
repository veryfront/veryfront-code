/**
 * Generates src/integrations/_data.ts from connector.json + SVG files.
 * Validates every connector against the Zod schema at build time.
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-env scripts/build/generate-integrations-module.ts
 */

import { IntegrationConfigSchema } from "../../src/integrations/schema.ts";
import type { IntegrationConfig } from "../../src/integrations/schema.ts";

const integrationsDir = "./cli/templates/integrations";
const dataPath = "./src/integrations/_data.ts";

const connectors: IntegrationConfig[] = [];
const icons: [string, string][] = [];
const errors: string[] = [];

for await (const entry of Deno.readDir(integrationsDir)) {
  if (!entry.isDirectory || entry.name === "_base") continue;

  const dirPath = `${integrationsDir}/${entry.name}`;

  try {
    const raw = await Deno.readTextFile(`${dirPath}/connector.json`);
    const json = JSON.parse(raw);

    if (json.internal) continue;

    // Strip fields not needed in the runtime module
    if (json.auth) {
      const { callbackPath: _, ...rest } = json.auth;
      json.auth = rest;
    }
    delete json.internal;
    delete json.version;
    delete json.SETUP_GUIDE;
    delete json.setupGuide;

    const result = IntegrationConfigSchema.safeParse(json);

    if (!result.success) {
      errors.push(
        `${entry.name}: ${result.error.issues.map((i) => `${i.path.join(".")} — ${i.message}`).join(", ")}`,
      );
      continue;
    }

    connectors.push(result.data);

    if (result.data.icon) {
      try {
        const svg = await Deno.readTextFile(`${dirPath}/${result.data.icon}`);
        icons.push([result.data.name, svg]);
      } catch {
        errors.push(`${entry.name}: icon "${result.data.icon}" declared but file not found`);
      }
    }
  } catch { /* no connector.json */ }
}

if (errors.length > 0) {
  console.error("❌ Validation errors:");
  for (const e of errors) console.error(`  ${e}`);
  Deno.exit(1);
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
import type { IntegrationConfig } from "./schema.ts";

export const connectors: IntegrationConfig[] = [
${connectorLines},
];

export const icons: Record<string, string> = {
${iconLines},
};
`,
);

console.log(
  `✅ Generated ${dataPath} (${connectors.length} connectors, ${icons.length} icons)`,
);
