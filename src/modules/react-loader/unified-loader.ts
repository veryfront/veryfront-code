import { join, toFileUrl } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { transformToESM } from "#veryfront/transforms/esm/index.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getProjectTmpDir } from "./temp-directory.ts";
import type { ComponentMap, ComponentSource, LoadComponentOptions } from "./types.ts";
import {
  DEFAULT_REACT_VERSION,
  getReactImportMap,
} from "#veryfront/transforms/esm/package-registry.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { extractComponent } from "./extract-component.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

type TransformedComponent = { name: string; code: string; index: number };
const MAX_UNIFIED_COMPONENTS = 1_000;
const MAX_COMPONENT_NAME_LENGTH = 256;
const MAX_COMPONENT_SOURCE_BYTES = 5 * 1024 * 1024;
const COMPONENT_BATCH_SIZE = 10;

function validateComponents(components: ComponentSource[]): void {
  if (components.length > MAX_UNIFIED_COMPONENTS) {
    throw INVALID_ARGUMENT.create({
      detail: `Component batch exceeds the limit of ${MAX_UNIFIED_COMPONENTS}`,
    });
  }

  const names = new Set<string>();
  for (const component of components) {
    if (
      component.name.length === 0 || component.name.length > MAX_COMPONENT_NAME_LENGTH ||
      hasUnsafeControlCharacters(component.name)
    ) {
      throw INVALID_ARGUMENT.create({ detail: "Component name is invalid" });
    }
    if (names.has(component.name)) {
      throw INVALID_ARGUMENT.create({ detail: "Component names must be unique" });
    }
    names.add(component.name);
    if (new TextEncoder().encode(component.source).byteLength > MAX_COMPONENT_SOURCE_BYTES) {
      throw INVALID_ARGUMENT.create({ detail: "Component source exceeds size limit" });
    }
  }
}

export function loadComponentsUnified(
  components: ComponentSource[],
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: LoadComponentOptions,
): Promise<ComponentMap> {
  return withSpan(
    "modules.loadComponentsUnified",
    async () => {
      validateComponents(components);
      const projectId = options?.projectId ?? projectDir;
      const dev = options?.dev ?? true;
      const moduleServerUrl = options?.moduleServerUrl;
      const reactVersion = options?.reactVersion;

      const transformOpts: TransformOptions = {
        projectId,
        dev,
        moduleServerUrl,
        reactVersion,
      };

      const transformedComponents = await transformAllComponents(
        components,
        projectDir,
        adapter,
        transformOpts,
      );

      const tmpDir = await createTempDir(projectId, adapter);

      try {
        await writeComponentFiles(tmpDir, transformedComponents, adapter);

        const entryCode = generateEntryPoint(transformedComponents, reactVersion);
        await adapter.fs.writeFile(join(tmpDir, "entry.js"), entryCode);

        return await importUnifiedComponents(tmpDir, transformedComponents);
      } finally {
        await cleanupTempDirectory(tmpDir, adapter);
      }
    },
    { "modules.componentCount": components.length },
  );
}

async function transformAllComponents(
  components: ComponentSource[],
  projectDir: string,
  adapter: RuntimeAdapter,
  transformOpts: TransformOptions,
): Promise<TransformedComponent[]> {
  const transformed: TransformedComponent[] = [];
  for (let index = 0; index < components.length; index += COMPONENT_BATCH_SIZE) {
    const batch = components.slice(index, index + COMPONENT_BATCH_SIZE);
    transformed.push(
      ...await Promise.all(
        batch.map(async (component, batchIndex) => ({
          name: component.name,
          index: index + batchIndex,
          code: await transformToESM(
            component.source,
            component.filePath,
            projectDir,
            adapter,
            transformOpts,
          ),
        })),
      ),
    );
  }
  return transformed;
}

async function createTempDir(projectId: string, adapter: RuntimeAdapter): Promise<string> {
  const baseTmp = await getProjectTmpDir(projectId);
  const uniqueTmp = `unified-${crypto.randomUUID()}`;
  const tmpDir = join(baseTmp, uniqueTmp);

  await adapter.fs.mkdir(tmpDir, { recursive: true });

  return tmpDir;
}

async function writeComponentFiles(
  tmpDir: string,
  components: TransformedComponent[],
  adapter: RuntimeAdapter,
): Promise<void> {
  for (let index = 0; index < components.length; index += COMPONENT_BATCH_SIZE) {
    const batch = components.slice(index, index + COMPONENT_BATCH_SIZE);
    await Promise.all(
      batch.map((component) =>
        adapter.fs.writeFile(join(tmpDir, `component-${component.index}.mjs`), component.code)
      ),
    );
  }
}

function generateEntryPoint(components: TransformedComponent[], reactVersion?: string): string {
  const version = reactVersion ?? DEFAULT_REACT_VERSION;
  const reactUrl = getReactImportMap(version).react;

  const imports = components
    .map((component) =>
      `import __vf_component_${component.index} from './component-${component.index}.mjs'`
    )
    .join("\n");

  const componentValues = components
    .map((component) => `__vf_component_${component.index}`)
    .join(", ");

  return `
    import ${JSON.stringify(reactUrl)}
    ${imports}

    export const __veryfrontComponents = [${componentValues}]
  `.trim();
}

async function importUnifiedComponents(
  tmpDir: string,
  components: TransformedComponent[],
): Promise<ComponentMap> {
  const mod = await import(toFileUrl(join(tmpDir, "entry.js")).href);
  const loaded = mod.__veryfrontComponents;
  if (!Array.isArray(loaded) || loaded.length !== components.length) {
    throw new TypeError("Unified component entry returned an invalid component set");
  }

  const result = Object.create(null) as ComponentMap;
  for (const component of components) {
    result[component.name] = extractComponent(
      { default: loaded[component.index] },
      component.name,
    );
  }

  return result;
}

async function cleanupTempDirectory(tmpDir: string, adapter: RuntimeAdapter): Promise<void> {
  try {
    await adapter.fs.remove(tmpDir, { recursive: true });
  } catch (error) {
    logger.warn("Failed to cleanup unified component directory", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}
