import { join } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { transformToESM } from "@veryfront/transforms/esm/transform-core.ts";
import type { TransformOptions } from "@veryfront/transforms/esm/types.ts";
import { rendererLogger as logger } from "@veryfront/utils";
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

  const tmpDir = await Deno.makeTempDir({ prefix: "vf-components-" });

  try {
    await writeComponentFiles(tmpDir, transformedComponents);

    const entryCode = generateEntryPoint(transformedComponents);
    await Deno.writeTextFile(join(tmpDir, "entry.js"), entryCode);

    const components = await importUnifiedComponents(tmpDir, transformedComponents);

    return components;
  } finally {
    await cleanupTempDirectory(tmpDir);
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
): Promise<void> {
  await Promise.all(
    components.map(async (comp) => {
      const fileName = `${comp.name}.js`;
      await Deno.writeTextFile(join(tmpDir, fileName), comp.code);
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

  return `
    import * as React from 'https://esm.sh/react@18.3.1'
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

async function cleanupTempDirectory(tmpDir: string): Promise<void> {
  try {
    await Deno.remove(tmpDir, { recursive: true });
  } catch (error) {
    logger.warn("Failed to cleanup temp directory", { tmpDir, error });
  }
}
