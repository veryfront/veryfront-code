/**
 * Extension init command — scaffold a new extension.
 *
 * @module cli/commands/extension/init-command
 */

export interface GeneratedFile {
  path: string;
  content: string;
}

const VALID_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Validate an extension name. Returns an error message if invalid,
 * or `undefined` if the name is acceptable.
 */
export function validateExtensionName(name: string): string | undefined {
  if (!name) return "Extension name is required.";
  if (!VALID_NAME.test(name)) {
    return "Extension name must be lowercase alphanumeric with hyphens (e.g., 'my-cache').";
  }
  if (name.length > 64) return "Extension name must be 64 characters or fewer.";
  return undefined;
}

/**
 * Generate the file contents for a new extension scaffold.
 * Does not write to disk — returns file path/content pairs.
 */
export function generateExtensionFiles(name: string): GeneratedFile[] {
  const base = `extensions/${name}`;

  const indexTs = `/**
 * ${name} extension.
 *
 * @module extensions/${name}
 */

import type { ExtensionFactory } from "veryfront/extensions";

const ${camelCase(name)}: ExtensionFactory = () => ({
  name: "${name}",
  version: "0.1.0",
  capabilities: [],

  // Uncomment and modify to provide a contract implementation:
  // provides: {
  //   ContractName: { /* implementation */ },
  // },

  // Uncomment for async setup:
  // async setup(ctx) {
  //   // ctx.get<T>("ContractName") — consume another contract
  //   // ctx.provide("ContractName", impl) — register a contract
  // },

  // Uncomment for cleanup:
  // async teardown() {
  //   // Close connections, flush buffers, etc.
  // },
});

export default ${camelCase(name)};
`;

  const testTs = `/**
 * ${name} extension tests.
 *
 * @module extensions/${name}/test
 */

import { assertEquals } from "veryfront/testing/assert";
import { describe, it } from "veryfront/testing/bdd";
import factory from "./index.ts";

describe("${name} extension", () => {
  it("should create an extension with correct name", () => {
    const ext = factory();
    assertEquals(ext.name, "${name}");
  });

  it("should have a version", () => {
    const ext = factory();
    assertEquals(typeof ext.version, "string");
    assertEquals(ext.version.length > 0, true);
  });

  it("should have a capabilities array", () => {
    const ext = factory();
    assertEquals(Array.isArray(ext.capabilities), true);
  });
});
`;

  const denoJson = JSON.stringify(
    {
      name: name,
      version: "0.1.0",
      veryfront: {
        extension: true,
        capabilities: [],
      },
    },
    null,
    2,
  );

  return [
    { path: `${base}/src/index.ts`, content: indexTs },
    { path: `${base}/src/index.test.ts`, content: testTs },
    { path: `${base}/deno.json`, content: denoJson + "\n" },
  ];
}

function camelCase(name: string): string {
  return name
    .split(/[-_]/)
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/**
 * Execute the extension init command: generate files and write to disk.
 */
export async function runExtensionInit(name: string, baseDir: string): Promise<void> {
  const error = validateExtensionName(name);
  if (error) throw new Error(error);

  const files = generateExtensionFiles(name);

  for (const file of files) {
    const fullPath = `${baseDir}/${file.path}`;
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(fullPath, file.content);
  }
}
