import { join } from "../../platform/compat/path/index.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import { transformToESM } from "../../transforms/esm/index.js";
import type { TransformOptions } from "../../transforms/esm/types.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { getProjectTmpDir } from "./temp-directory.js";
import type { ComponentMap, ComponentSource, LoadComponentOptions } from "./types.js";
import {
  DEFAULT_REACT_VERSION,
  getReactImportMap,
} from "../../transforms/esm/package-registry.js";

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
      const reactVersion = options?.reactVersion;

      const transformOpts: TransformOptions = { projectId, dev, moduleServerUrl, reactVersion };
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

        const entryCode = generateEntryPoint(transformedComponents, reactVersion);
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

function generateEntryPoint(components: TransformedComponent[], reactVersion?: string): string {
  const version = reactVersion ?? DEFAULT_REACT_VERSION;
  // Use centralized React URL from package-registry to ensure consistency
  const reactUrl = getReactImportMap(version).react;
  const imports = components
    .map((comp) => `import { default as ${comp.name} } from './${comp.name}.js'`)
    .join("\n");

  const exports = components.map((comp) => comp.name).join(", ");

  return `
    import * as React from '${reactUrl}'
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
