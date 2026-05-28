/**
 * Generates src/integrations/_data.ts and summary metadata from connector.json + SVG files.
 * Validates every connector against the Zod schema at build time.
 *
 * Usage:
 *   deno run -A scripts/build/generate-integrations-module.ts
 */

import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";
import { register, tryResolve } from "../../src/extensions/contracts.ts";
import type { SchemaValidator } from "../../src/extensions/schema/index.ts";
import { IntegrationConfigSchema } from "../../src/integrations/schema.ts";
import type { IntegrationConfig } from "../../src/integrations/schema.ts";
import { formatGeneratedModuleEntries } from "./integrations-module-format.ts";

if (!tryResolve<SchemaValidator>("SchemaValidator")) {
  register<SchemaValidator>("SchemaValidator", createZodAdapter());
}

const integrationsDir = "./cli/templates/integrations";
const dataPath = "./src/integrations/_data.ts";
const summaryPath = "./src/integrations/_tool_summaries.ts";

const connectors: IntegrationConfig[] = [];
const icons: [string, string][] = [];
const historicalToolSummaries: [string, NonNullable<
  NonNullable<IntegrationConfig["tools"][number]["endpoint"]>["response"]
>["historicalSummary"]][] = [];
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
        `${entry.name}: ${
          result.error.issues.map((i) => `${i.path.join(".")} — ${i.message}`)
            .join(", ")
        }`,
      );
      continue;
    }

    connectors.push(result.data);
    for (const tool of result.data.tools) {
      const historicalSummary = tool.endpoint?.response?.historicalSummary;
      if (!tool.id || !historicalSummary) continue;
      historicalToolSummaries.push([`${result.data.name}__${tool.id}`, historicalSummary]);
    }

    if (result.data.icon) {
      try {
        const svg = await Deno.readTextFile(`${dirPath}/${result.data.icon}`);
        icons.push([result.data.name, svg]);
      } catch {
        errors.push(
          `${entry.name}: icon "${result.data.icon}" declared but file not found`,
        );
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
historicalToolSummaries.sort((a, b) => a[0].localeCompare(b[0]));

const connectorLines = formatGeneratedModuleEntries(
  connectors.map((c) => `  ${JSON.stringify(c)}`),
);

const iconLines = formatGeneratedModuleEntries(
  icons.map(([name, svg]) =>
    `  ${JSON.stringify(name)}: ${JSON.stringify(svg)}`
  ),
);

const historicalToolSummaryLines = formatGeneratedModuleEntries(
  historicalToolSummaries.map(([toolName, summary]) =>
    `  ${JSON.stringify(toolName)}: ${JSON.stringify(summary)}`
  ),
);

await Deno.writeTextFile(
  dataPath,
  `// Auto-generated — do not edit
import type { IntegrationConfig } from "./schema.ts";

export const connectors: IntegrationConfig[] = [
${connectorLines}
];

export const icons: Record<string, string> = {
${iconLines}
};
`,
);

await Deno.writeTextFile(
  summaryPath,
  `// Auto-generated — do not edit
import type { IntegrationEndpointHistoricalSummary } from "./schema.ts";

export const historicalToolSummaries: Record<string, IntegrationEndpointHistoricalSummary> = {
${historicalToolSummaryLines}
};
`,
);

console.log(
  `✅ Generated ${dataPath} (${connectors.length} connectors, ${icons.length} icons)`,
);
console.log(
  `✅ Generated ${summaryPath} (${historicalToolSummaries.length} summary contracts)`,
);
