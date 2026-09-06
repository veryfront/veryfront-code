import { assertEquals } from "#std/assert";
import { walk } from "#std/fs/walk";
import { fromFileUrl } from "#std/path";

const repoRoot = fromFileUrl(new URL("../../", import.meta.url));

interface DenoConfig {
  imports?: Record<string, string>;
  exports?: Record<string, string>;
}

async function readConfig(relPath: string): Promise<DenoConfig> {
  const text = await Deno.readTextFile(`${repoRoot}${relPath}`);
  return JSON.parse(text);
}

async function readImports(relPath: string): Promise<Record<string, string>> {
  const parsed = await readConfig(relPath);
  return parsed.imports ?? {};
}

async function collectSourceFiles(): Promise<string[]> {
  const files: string[] = [];
  const roots = ["cli", "src"];
  for (const root of roots) {
    for await (
      const entry of walk(`${repoRoot}${root}`, {
        exts: [".ts", ".tsx"],
        skip: [/\/templates\//, /\/__tests__\/fixtures\//, /\/node_modules\//],
      })
    ) {
      if (entry.isFile) files.push(entry.path);
    }
  }
  return files;
}

async function countReferences(alias: string, files: string[]): Promise<number> {
  const needle = `"${alias}"`;
  let total = 0;
  for (const file of files) {
    const text = await Deno.readTextFile(file);
    if (text.includes(needle)) total++;
  }
  return total;
}

Deno.test("every #cli/* and #veryfront/cli/* import alias has at least one caller", async () => {
  const rootImports = await readImports("deno.json");
  const cliImports = await readImports("cli/deno.json");

  const aliases = [
    ...Object.keys(rootImports),
    ...Object.keys(cliImports),
  ].filter((key) => key.startsWith("#cli/") || key.startsWith("#veryfront/cli/"));

  const files = await collectSourceFiles();
  const dead: string[] = [];

  for (const alias of aliases) {
    const refs = await countReferences(alias, files);
    if (refs === 0) dead.push(alias);
  }

  assertEquals(dead, [], `Dead cli aliases (no callers in cli/ or src/): ${dead.join(", ")}`);
});

Deno.test("host-private CLI aliases remain exact and unpublished", async () => {
  const config = await readConfig("deno.json");
  const aliases = {
    "#cli/environment-config": "./src/config/environment-config.ts",
    "#cli/host-api-base": "./src/config/host-api-base.ts",
  } as const;

  for (const [alias, target] of Object.entries(aliases)) {
    assertEquals(config.imports?.[alias], target);
    assertEquals(Object.values(config.exports ?? {}).includes(target), false);
  }
});
