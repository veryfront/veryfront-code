import { join, toFileUrl } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { transformToESM } from "#veryfront/transforms/esm/index.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { parallelMap } from "#veryfront/utils/parallel.ts";
import { PermitSemaphore } from "#veryfront/utils/permit-semaphore.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getProjectTmpDir } from "./temp-directory.ts";
import type { ComponentMap, ComponentSource, LoadComponentOptions } from "./types.ts";
import { snapshotImportMap } from "#veryfront/transforms/pipeline/cache-identity.ts";
import { assertReactComponentType } from "./react-component-type.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

const MAX_COMPONENTS = 10_000;
const MAX_COMPONENT_NAME_LENGTH = 4_096;
const MAX_TOTAL_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_TRANSFORMED_COMPONENT_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_TRANSFORMED_BYTES = 64 * 1024 * 1024;
const TRANSFORM_CONCURRENCY = 20;
const FILE_WRITE_CONCURRENCY = 32;
const MAX_QUEUED_OPERATIONS = 1_000;

const transformSemaphore = new PermitSemaphore(TRANSFORM_CONCURRENCY, {
  maxQueueSize: MAX_QUEUED_OPERATIONS,
});
const fileWriteSemaphore = new PermitSemaphore(FILE_WRITE_CONCURRENCY, {
  maxQueueSize: MAX_QUEUED_OPERATIONS,
});

const objectDefineProperty = Object.defineProperty;
const arrayIsArray = Array.isArray;

interface TransformedComponent {
  readonly name: string;
  readonly sourcePath: string;
  readonly fileName: string;
  readonly code: string;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function requireBoundedPath(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    containsControlCharacter(value)
  ) {
    throw new TypeError(
      `${field} must contain 1 to ${MAX_PATH_LENGTH_CHARS} characters without control characters`,
    );
  }
  return value;
}

function snapshotComponents(components: ComponentSource[]): ComponentSource[] {
  if (!arrayIsArray(components)) {
    throw new TypeError("components must be an array");
  }
  if (components.length > MAX_COMPONENTS) {
    throw new RangeError(`Component batch exceeds the ${MAX_COMPONENTS}-component limit`);
  }

  const names = new Set<string>();
  const snapshot: ComponentSource[] = [];
  let totalSourceBytes = 0;

  for (let index = 0; index < components.length; index++) {
    const component = components[index] as ComponentSource | undefined;
    if (typeof component !== "object" || component === null) {
      throw new TypeError(`components[${index}] must be an object`);
    }

    const name = component.name;
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > MAX_COMPONENT_NAME_LENGTH ||
      containsControlCharacter(name)
    ) {
      throw new TypeError(
        `components[${index}].name must contain 1 to ${MAX_COMPONENT_NAME_LENGTH} characters without control characters`,
      );
    }
    if (names.has(name)) {
      throw new TypeError(`duplicate component name "${name}"`);
    }
    names.add(name);

    const filePath = requireBoundedPath(
      component.filePath,
      `components[${index}].filePath`,
    );
    const source = component.source;
    if (typeof source !== "string") {
      throw new TypeError(`components[${index}].source must be a string`);
    }
    const sourceBytes = utf8ByteLength(source, DEFAULT_MAX_FILE_SIZE_BYTES);
    if (sourceBytes > DEFAULT_MAX_FILE_SIZE_BYTES) {
      throw new RangeError(
        `Component source exceeds ${DEFAULT_MAX_FILE_SIZE_BYTES} bytes: ${filePath}`,
      );
    }
    if (sourceBytes > MAX_TOTAL_SOURCE_BYTES - totalSourceBytes) {
      throw new RangeError(
        `Component batch source exceeds ${MAX_TOTAL_SOURCE_BYTES} bytes`,
      );
    }
    totalSourceBytes += sourceBytes;
    snapshot.push({ name, filePath, source });
  }

  return snapshot;
}

function createComponentMap(
  components: readonly TransformedComponent[],
  values: readonly unknown[],
): ComponentMap {
  const result = {} as ComponentMap;
  for (let index = 0; index < components.length; index++) {
    const component = components[index]!;
    objectDefineProperty(result, component.name, {
      configurable: true,
      enumerable: true,
      value: assertReactComponentType(values[index], component.sourcePath),
      writable: true,
    });
  }
  return result;
}

export function loadComponentsUnified(
  components: ComponentSource[],
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: LoadComponentOptions,
): Promise<ComponentMap> {
  const componentCount = arrayIsArray(components) ? components.length : 0;
  const tracedProjectDir = typeof projectDir === "string" &&
      projectDir.length <= MAX_PATH_LENGTH_CHARS &&
      !containsControlCharacter(projectDir)
    ? projectDir
    : "<invalid>";
  return withSpan(
    "modules.loadComponentsUnified",
    async () => {
      const componentSnapshot = snapshotComponents(components);
      const validatedProjectDir = requireBoundedPath(projectDir, "projectDir");
      if (componentSnapshot.length === 0) {
        return createComponentMap([], []);
      }

      const projectId = options?.projectId ?? validatedProjectDir;
      const dev = options?.dev ?? true;
      const moduleServerUrl = options?.moduleServerUrl;
      const reactVersion = options?.reactVersion;
      const ssr = options?.ssr ?? false;
      const explicitImportMap = options?.importMap
        ? snapshotImportMap(options.importMap)
        : undefined;

      const transformOpts: TransformOptions = {
        projectId,
        dev,
        moduleServerUrl,
        reactVersion,
        ssr,
        vendorBundleHash: options?.vendorBundleHash,
        ...(explicitImportMap ? { loadImportMap: async () => explicitImportMap } : {}),
      };

      const transformedComponents = await transformAllComponents(
        componentSnapshot,
        validatedProjectDir,
        adapter,
        transformOpts,
      );

      const fs = createFileSystem();
      const tmpDir = await createTempDir(projectId, fs);

      try {
        await writeComponentFiles(tmpDir, transformedComponents, fs);

        const entryPath = join(tmpDir, "entry.mjs");
        await persistMaterializedFile(
          fs,
          entryPath,
          generateEntryPoint(transformedComponents),
          "unified component entry module",
        );

        return await importUnifiedComponents(entryPath, transformedComponents);
      } finally {
        await cleanupTempDirectory(tmpDir, fs);
      }
    },
    {
      "modules.projectDir": tracedProjectDir,
      "modules.componentCount": componentCount,
    },
  );
}

async function transformAllComponents(
  components: ComponentSource[],
  projectDir: string,
  adapter: RuntimeAdapter,
  transformOpts: TransformOptions,
): Promise<TransformedComponent[]> {
  const transformed = await parallelMap(
    components,
    async (comp, index) => ({
      name: comp.name,
      sourcePath: comp.filePath,
      fileName: `component-${index}.mjs`,
      code: await transformToESM(comp.source, comp.filePath, projectDir, adapter, transformOpts),
    }),
    {
      concurrency: TRANSFORM_CONCURRENCY,
      semaphore: transformSemaphore,
    },
  );

  let totalBytes = 0;
  for (const component of transformed) {
    const bytes = utf8ByteLength(component.code, MAX_TRANSFORMED_COMPONENT_BYTES);
    if (bytes > MAX_TRANSFORMED_COMPONENT_BYTES) {
      throw new RangeError(
        `Transformed component exceeds ${MAX_TRANSFORMED_COMPONENT_BYTES} bytes: ${component.sourcePath}`,
      );
    }
    if (bytes > MAX_TOTAL_TRANSFORMED_BYTES - totalBytes) {
      throw new RangeError(
        `Transformed component batch exceeds ${MAX_TOTAL_TRANSFORMED_BYTES} bytes`,
      );
    }
    totalBytes += bytes;
  }

  return transformed;
}

async function createTempDir(projectId: string, fs: FileSystem): Promise<string> {
  const baseTmp = await getProjectTmpDir(projectId);
  const uniqueTmp = `unified-${crypto.randomUUID()}`;
  const tmpDir = join(baseTmp, uniqueTmp);

  // A non-recursive create makes the UUID an exclusive ownership token. A
  // collision fails instead of reusing another load's directory.
  await fs.mkdir(tmpDir);

  return tmpDir;
}

async function writeComponentFiles(
  tmpDir: string,
  components: TransformedComponent[],
  fs: FileSystem,
): Promise<void> {
  await parallelMap(
    components,
    (component) =>
      persistMaterializedFile(
        fs,
        join(tmpDir, component.fileName),
        component.code,
        `transformed component ${component.sourcePath}`,
      ),
    {
      concurrency: FILE_WRITE_CONCURRENCY,
      semaphore: fileWriteSemaphore,
    },
  );
}

async function persistMaterializedFile(
  fs: FileSystem,
  path: string,
  code: string,
  description: string,
): Promise<void> {
  await fs.writeTextFile(path, code);
  const stat = await fs.stat(path);
  if (!stat.isFile) {
    throw new Error(`Failed to persist ${description}`);
  }
}

function generateEntryPoint(components: TransformedComponent[]): string {
  const imports = components
    .map((component, index) =>
      `import component${index} from ${JSON.stringify(`./${component.fileName}`)};`
    )
    .join("\n");
  const values = components.map((_, index) => `component${index}`).join(", ");
  return `${imports}\nexport default [${values}];\n`;
}

async function importUnifiedComponents(
  entryPath: string,
  components: TransformedComponent[],
): Promise<ComponentMap> {
  const mod = await import(toFileUrl(entryPath).href);
  const values: unknown = mod.default;
  if (!arrayIsArray(values) || values.length !== components.length) {
    throw new TypeError("Unified component entry returned an invalid export table");
  }
  return createComponentMap(components, values);
}

async function cleanupTempDirectory(tmpDir: string, fs: FileSystem): Promise<void> {
  try {
    await fs.remove(tmpDir, { recursive: true });
  } catch (error) {
    logger.warn("Failed to cleanup temp directory", { tmpDir, error });
  }
}
