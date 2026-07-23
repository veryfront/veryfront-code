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
import { assertSafeIntegrationIconSvg } from "../../src/integrations/icon-validation.ts";
import { IntegrationConfigSchema } from "../../src/integrations/schema.ts";
import type { IntegrationConfig } from "../../src/integrations/schema.ts";
import {
  formatConnectorIconFailure,
  formatConnectorIdentityMismatch,
  formatConnectorSourceFailure,
  formatConnectorSourceMetadataFailure,
  formatGeneratedModuleEntries,
  isConnectorSourceRecord,
} from "./integrations-module-format.ts";

if (!tryResolve<SchemaValidator>("SchemaValidator")) {
  register<SchemaValidator>("SchemaValidator", createZodAdapter());
}

const integrationsDir = "./cli/templates/integrations";
const dataPath = "./src/integrations/_data.ts";
const summaryPath = "./src/integrations/_tool_summaries.ts";

const connectors: IntegrationConfig[] = [];
const icons: [string, string][] = [];
const historicalToolSummaries: [
  string,
  NonNullable<
    NonNullable<IntegrationConfig["tools"][number]["endpoint"]>["response"]
  >["historicalSummary"],
][] = [];
const errors: string[] = [];

for await (const entry of Deno.readDir(integrationsDir)) {
  if (!entry.isDirectory || entry.name === "_base") continue;

  const dirPath = `${integrationsDir}/${entry.name}`;

  try {
    const raw = await Deno.readTextFile(`${dirPath}/connector.json`);
    const json = JSON.parse(raw);

    if (!isConnectorSourceRecord(json)) {
      errors.push(formatConnectorSourceMetadataFailure(entry.name));
      continue;
    }
    if (json.internal === true) continue;

    // Strip source-only fields that are not part of the runtime schema.
    delete json.internal;
    delete json.version;
    // Keep setup guides in the runtime catalog. They power the
    // missing-credentials UX in chat (how a user obtains each key).
    const setupGuide = json.setupGuide ?? json.SETUP_GUIDE;
    // Markdown-string guides (legacy authoring style) are wrapped as a single
    // step so they still reach the missing-credentials UX.
    if (typeof setupGuide === "object" && setupGuide !== null) {
      // Drop explicit nulls (legacy authoring) so optional fields validate.
      json.setupGuide = {
        ...setupGuide,
        steps: (setupGuide.steps ?? []).map((step: Record<string, unknown>) =>
          Object.fromEntries(
            Object.entries(step).filter(([, value]) =>
              value !== null && value !== undefined
            ),
          )
        ),
      };
    } else if (typeof setupGuide === "string" && setupGuide.length > 0) {
      // Markdown-string guides (legacy authoring style) become a single step.
      json.setupGuide = {
        steps: [{ title: "Setup guide", description: setupGuide }],
      };
    } else {
      json.setupGuide = undefined;
    }
    delete json.SETUP_GUIDE;

    const result = IntegrationConfigSchema.safeParse(json);

    if (!result.success) {
      errors.push(
        `${entry.name}: ${
          result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(", ")
        }`,
      );
      continue;
    }

    if (result.data.name !== entry.name) {
      errors.push(formatConnectorIdentityMismatch(entry.name));
      continue;
    }

    // Validate callbackPath above, then omit it from the runtime catalog.
    const { callbackPath: _, ...runtimeAuth } = result.data.auth;
    const connector: IntegrationConfig = { ...result.data, auth: runtimeAuth };

    connectors.push(connector);
    for (const tool of connector.tools) {
      const historicalSummary = tool.endpoint?.response?.historicalSummary;
      if (!tool.id || !historicalSummary) continue;
      historicalToolSummaries.push([
        tool.id,
        historicalSummary,
      ]);
    }

    if (connector.icon) {
      try {
        const svg = await Deno.readTextFile(`${dirPath}/${connector.icon}`);
        icons.push([connector.name, assertSafeIntegrationIconSvg(svg)]);
      } catch (error) {
        errors.push(formatConnectorIconFailure(entry.name, error));
      }
    }
  } catch (error) {
    errors.push(formatConnectorSourceFailure(entry.name, error));
  }
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
  `// Auto-generated, do not edit
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
  `// Auto-generated, do not edit
import type { IntegrationEndpointHistoricalSummary } from "./schema.ts";

export const historicalToolSummaries: Record<string, IntegrationEndpointHistoricalSummary> = {
${historicalToolSummaryLines}
};
`,
);

const fmt = new Deno.Command(Deno.execPath(), {
  args: ["fmt", dataPath, summaryPath],
  stdout: "inherit",
  stderr: "inherit",
});
const fmtStatus = await fmt.output();
if (!fmtStatus.success) {
  throw new Error(`Failed to format generated integration modules`);
}

console.log(
  `✅ Generated ${dataPath} (${connectors.length} connectors, ${icons.length} icons)`,
);
console.log(
  `✅ Generated ${summaryPath} (${historicalToolSummaries.length} summary contracts)`,
);
