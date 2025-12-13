import { join } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { transformToESM } from "@veryfront/transforms/esm/transform-core.ts";
import type { TransformOptions } from "@veryfront/transforms/esm/types.ts";
import { rendererLogger as logger, REACT_DEFAULT_VERSION } from "@veryfront/utils";
import { getGlobalTmpDir } from "./temp-directory.ts";
import type { ComponentMap, ComponentSource, LoadComponentOptions } from "./types.ts";

export async function loadComponentsUnified(
  components: ComponentSource[],
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: LoadComponentOptions,
): Promise<ComponentMap> {
  const projectId = options?.projectId || projectDir;
  const dev = options?.dev ?? true;
  const moduleServerUrl = options?.moduleServerUrl;

  const transformOpts: TransformOptions = { projectId, dev, moduleServerUrl };
  const transformedComponents = await transformAllComponents(
    components,
    projectDir,
    adapter,
    transformOpts,
  );

  const baseTmp = await getGlobalTmpDir();
  const uniqueTmp = `unified-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tmpDir = join(baseTmp, uniqueTmp);
  await adapter.fs.mkdir(tmpDir, { recursive: true });

  try {
    await writeComponentFiles(tmpDir, transformedComponents, adapter);

    const entryCode = generateEntryPoint(transformedComponents);
    await adapter.fs.writeFile(join(tmpDir, "entry.js"), entryCode);

    const loadedComponents = await importUnifiedComponents(tmpDir, transformedComponents);

    return loadedComponents;
  } finally {
    await cleanupTempDirectory(tmpDir, adapter);
  }
}

async function transformAllComponents(
  components: ComponentSource[],
  projectDir: string,
  adapter: RuntimeAdapter,
  transformOpts: TransformOptions,
): Promise<Array<{ name: string; code: string }>> {
  return await Promise.all(
    components.map(async (comp) => ({
      name: comp.name,
      code: await transformToESM(
        comp.source,
        comp.filePath,
        projectDir,
        adapter,
        transformOpts,
      ),
    })),
  );
}

async function writeComponentFiles(
  tmpDir: string,
  components: Array<{ name: string; code: string }>,
  adapter: RuntimeAdapter,
): Promise<void> {
  await Promise.all(
    components.map(async (comp) => {
      const fileName = `${comp.name}.js`;
      await adapter.fs.writeFile(join(tmpDir, fileName), comp.code);
    }),
  );
}

function generateEntryPoint(
  components: Array<{ name: string; code: string }>,
): string {
  const imports = components
    .map((comp) => `import { default as ${comp.name} } from './${comp.name}.js'`)
    .join("\n");

  const exports = components.map((comp) => comp.name).join(", ");

  // Use globalThis.__VERYFRONT_REACT__ to avoid dynamic remote imports in compiled binaries
  // (Deno compile cannot fetch remote URLs at runtime)
  // Fallback to dynamic import for cases where globalThis is not yet set
  return `
    const React = globalThis.__VERYFRONT_REACT__ || (await import('https://esm.sh/react@${REACT_DEFAULT_VERSION}'));
    ${imports}

    export { ${exports} }
  `.trim();
}

async function importUnifiedComponents(
  tmpDir: string,
  components: Array<{ name: string; code: string }>,
): Promise<ComponentMap> {
  const cacheBuster = Date.now();
  const mod = await import(`file://${join(tmpDir, "entry.js")}?t=${cacheBuster}`);

  const result: ComponentMap = {};
  for (const comp of components) {
    result[comp.name] = mod[comp.name];
  }

  return result;
}

async function cleanupTempDirectory(tmpDir: string, adapter: RuntimeAdapter): Promise<void> {
  try {
    await adapter.fs.remove(tmpDir, { recursive: true });
  } catch (error) {
    logger.warn("Failed to cleanup temp directory", { tmpDir, error });
  }
}
