import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, join, normalize } from "#veryfront/compat/path/index.ts";
import {
  ALL_AVAILABLE_INTEGRATIONS,
  loadIntegration,
  loadIntegrationBaseFilesFromDirectory,
} from "./integration-loader.ts";
import { mergeFiles } from "./loader.ts";
import type { TemplateFile } from "./types.ts";

// Integration scaffolds whose files still import names that no scaffolded
// module exports. Shrink this list as scaffolds are fixed; a new scaffold must
// resolve every named import.
const SCAFFOLDS_WITH_UNRESOLVED_IMPORTS = [
  "airtable",
  "asana",
  "confluence",
  "figma",
  "gitlab",
  "jira",
  "linear",
  "mixpanel",
  "neon",
  "notion",
  "onedrive",
  "outlook",
  "posthog",
  "salesforce",
  "sentry",
  "servicenow",
  "sharepoint",
  "shopify",
  "snowflake",
  "stripe",
  "supabase",
  "teams",
  "trello",
];

const NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'](\.{1,2}\/[^"']+)["']/g;
const DECLARED_EXPORT =
  /export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST = /export\s+(?:type\s+)?\{([^}]*)\}/g;

function names(list: string, pick: "local" | "exported"): string[] {
  return list.split(",")
    .map((entry) => entry.trim().replace(/^type\s+/, ""))
    .filter(Boolean)
    .map((entry) => {
      const [local, exported] = entry.split(/\s+as\s+/);
      return (pick === "exported" ? exported ?? local : local)!.trim();
    });
}

/** Drop block comments and whole-line comments so documented examples do not count. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function exportedNames(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(DECLARED_EXPORT)) found.add(match[1]!);
  for (const match of source.matchAll(EXPORT_LIST)) {
    for (const name of names(match[1]!, "exported")) found.add(name);
  }
  return found;
}

/** Named imports between scaffolded files that the target module does not export. */
function unresolvedImports(files: TemplateFile[]): string[] {
  const byPath = new Map(files.map((file) => [file.path, stripComments(file.content)]));
  const problems: string[] = [];

  for (const file of files) {
    if (!/\.tsx?$/.test(file.path)) continue;
    for (const match of byPath.get(file.path)!.matchAll(NAMED_IMPORT)) {
      const target = normalize(join(dirname(file.path), match[2]!));
      const targetSource = byPath.get(target);
      if (targetSource === undefined) continue;
      const exported = exportedNames(targetSource);
      for (const name of names(match[1]!, "local")) {
        if (!exported.has(name)) problems.push(`${file.path}: ${name} from ${target}`);
      }
    }
  }
  return problems;
}

/** The files `veryfront init --integrations <name>` writes for one integration. */
async function scaffoldFiles(
  name: (typeof ALL_AVAILABLE_INTEGRATIONS)[number],
): Promise<TemplateFile[]> {
  const integration = await loadIntegration(name);
  if (!integration) return [];
  return mergeFiles(await loadIntegrationBaseFilesFromDirectory(), integration.files);
}

describe("integration scaffold imports", () => {
  it("resolves every named import between the Twilio scaffold's files", async () => {
    assertEquals(unresolvedImports(await scaffoldFiles("twilio")), []);
  });

  it("resolves every named import in each scaffold outside the pending list", async () => {
    const broken: string[] = [];
    for (const name of ALL_AVAILABLE_INTEGRATIONS) {
      if (unresolvedImports(await scaffoldFiles(name)).length > 0) broken.push(name);
    }

    assertEquals(broken.sort(), SCAFFOLDS_WITH_UNRESOLVED_IMPORTS);
  });
});
