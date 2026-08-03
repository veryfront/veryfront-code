import { assert, assertEquals } from "#std/assert";
import { globToRegExp, join } from "#std/path";
import { describe, it } from "#veryfront/testing/bdd.ts";

interface DenoConfig {
  lint?: {
    include?: string[];
    exclude?: string[];
  };
}

const EXTENSION_SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;
const EXTENSION_LINT_PATTERNS = [
  "extensions/**/*.ts",
  "extensions/**/*.tsx",
] as const;

function isExtensionSource(path: string): boolean {
  return EXTENSION_SOURCE_EXTENSIONS.some((extension) =>
    path.endsWith(extension)
  );
}

function isCoveredByGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern, { globstar: true }).test(
    path.replaceAll("\\", "/"),
  );
}

async function collectExtensionSources(root = "extensions"): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
      const path = join(directory, entry.name);
      if (entry.isDirectory) {
        await walk(path);
        continue;
      }
      if (entry.isFile && isExtensionSource(path)) {
        files.push(path);
      }
    }
  }
  await walk(root);
  return files.sort();
}

async function readLintConfig(): Promise<
  Required<NonNullable<DenoConfig["lint"]>>
> {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as DenoConfig;
  return {
    include: config.lint?.include ?? [],
    exclude: config.lint?.exclude ?? [],
  };
}

describe("root lint configuration", () => {
  it("covers extension sources", async () => {
    const { include, exclude } = await readLintConfig();
    const extensionSources = await collectExtensionSources();

    assert(extensionSources.length > 0);
    assertEquals(
      EXTENSION_LINT_PATTERNS.every((pattern) => include.includes(pattern)),
      true,
    );
    assertEquals(
      extensionSources.filter((source) =>
        !include.some((pattern) => isCoveredByGlob(source, pattern)) ||
        exclude.some((pattern) => isCoveredByGlob(source, pattern))
      ),
      [],
    );
  });

  it("keeps production-build JavaScript templates inside the lint gate", async () => {
    const { include, exclude } = await readLintConfig();
    const templates = [
      "src/build/production-build/templates/fallback-prefetch.js",
      "src/build/production-build/templates/fallback-router.js",
    ];

    assertEquals(
      templates.filter((template) =>
        !include.some((pattern) => isCoveredByGlob(template, pattern)) ||
        exclude.some((pattern) => isCoveredByGlob(template, pattern))
      ),
      [],
    );
  });
});
