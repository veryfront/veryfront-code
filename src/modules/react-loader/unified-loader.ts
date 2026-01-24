import { join } from "#veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { transformToESM } from "#veryfront/transforms/esm/index.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getProjectTmpDir } from "./temp-directory.ts";
import type { ComponentMap, ComponentSource, LoadComponentOptions } from "./types.ts";

type TransformedComponent = { name: string; code: string };

export function loadComponentsUnified(
  components: ComponentSource[],
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: LoadComponentOptions,
): Promise<ComponentMap> {
  return withSpan(
    "modules.loadComponentsUnified",
    async () => {
      const projectId = options?.projectId ?? projectDir;
      const dev = options?.dev ?? true;
      const moduleServerUrl = options?.moduleServerUrl;

      const transformOpts: TransformOptions = { projectId, dev, moduleServerUrl };
      const transformedComponents = await transformAllComponents(
        components,
        projectDir,
        adapter,
        transformOpts,
      );

      const baseTmp = await getProjectTmpDir(projectId);
      const uniqueTmp = `unified-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const tmpDir = join(baseTmp, uniqueTmp);
      await adapter.fs.mkdir(tmpDir, { recursive: true });

      try {
        await writeComponentFiles(tmpDir, transformedComponents, adapter);

        const entryCode = generateEntryPoint(transformedComponents);
        await adapter.fs.writeFile(join(tmpDir, "entry.js"), entryCode);

        return await importUnifiedComponents(tmpDir, transformedComponents);
      } finally {
        await cleanupTempDirectory(tmpDir, adapter);
      }
    },
    { "modules.projectDir": projectDir, "modules.componentCount": components.length },
  );
}

function transformAllComponents(
  components: ComponentSource[],
  projectDir: string,
  adapter: RuntimeAdapter,
  transformOpts: TransformOptions,
): Promise<TransformedComponent[]> {
  return Promise.all(
    components.map(async (comp) => ({
      name: comp.name,
      code: await transformToESM(comp.source, comp.filePath, projectDir, adapter, transformOpts),
    })),
  );
}

async function writeComponentFiles(
  tmpDir: string,
  components: TransformedComponent[],
  adapter: RuntimeAdapter,
): Promise<void> {
  await Promise.all(
    components.map((comp) => adapter.fs.writeFile(join(tmpDir, `${comp.name}.js`), comp.code)),
  );
}

function generateEntryPoint(components: TransformedComponent[]): string {
  const imports = components
    .map((comp) => `import { default as ${comp.name} } from './${comp.name}.js'`)
    .join("\n");

  const exports = components.map((comp) => comp.name).join(", ");

  return `
    import * as React from 'https://esm.sh/react@18.3.1?target=es2022'
    ${imports}

    export { ${exports} }
  `.trim();
}

async function importUnifiedComponents(
  tmpDir: string,
  components: TransformedComponent[],
): Promise<ComponentMap> {
  const mod = await import(`file://${join(tmpDir, "entry.js")}?t=${Date.now()}`);

  const result: ComponentMap = {};
  for (const { name } of components) {
    result[name] = mod[name];
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
