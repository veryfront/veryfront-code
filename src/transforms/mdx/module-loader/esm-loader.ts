import type { MDXModule } from "./types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export function loadESMModule(
  moduleCode: string,
  _modulePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<MDXModule> {
  return withSpan("transforms.mdx.loadESMModule", async () => {
    const { loadImportMap, transformImportsWithMap } = await import(
      "../../../../modules/import-map/index.ts"
    );
    const importMap = await loadImportMap(projectDir, adapter);

    const transformed = transformImportsWithMap(moduleCode, importMap, undefined, {
      resolveBare: true,
    });

    const tmpDir = await adapter.fs.makeTempDir("veryfront-mdx-esm-");
    const tmpFile = `${tmpDir}/${crypto.randomUUID()}.mjs`;

    await adapter.fs.writeFile(tmpFile, transformed);

    const module = await import(`file://${tmpFile}?v=${Date.now()}`);
    return module as MDXModule;
  }, { "mdx.code_length": moduleCode.length });
}

export function isESMModule(moduleCode: string): boolean {
  return !moduleCode.includes("new Function");
}
