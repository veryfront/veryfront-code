import { assert, assertEquals } from "#std/assert";
import { join } from "#std/path";

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

function globPrefix(pattern: string): string {
  return pattern.slice(0, pattern.indexOf("**"));
}

function isCoveredByGlob(path: string, pattern: string): boolean {
  if (!pattern.includes("**")) return path === pattern;
  const prefix = globPrefix(pattern);
  const suffix = pattern.slice(pattern.lastIndexOf("*") + 1);
  return path.startsWith(prefix) && path.endsWith(suffix);
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

Deno.test("root lint configuration covers extension sources", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as DenoConfig;
  const include = config.lint?.include ?? [];
  const exclude = config.lint?.exclude ?? [];
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
