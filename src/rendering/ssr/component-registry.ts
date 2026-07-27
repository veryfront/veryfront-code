import { join } from "#veryfront/compat/path";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type {
  DirEntry,
  FileSystemAdapter,
  RuntimeAdapter,
} from "#veryfront/platform/adapters/base.ts";
import { loadComponentFromSource } from "#veryfront/modules/react-loader/component-loader.ts";
import type { LoadComponentOptions } from "#veryfront/modules/react-loader/types.ts";
import type * as React from "react";
import { rendererLogger as logger } from "#veryfront/utils";
import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { containsPathControlCharacters } from "#veryfront/utils/route-path-utils.ts";
import { isWithinDirectory, normalizePath } from "#veryfront/utils/path-utils.ts";
import { type VirtualModuleRegistration, VirtualModuleSystem } from "../virtual-module-system.ts";

const COMPONENT_EXTENSION = /^(.*)\.(tsx|jsx|ts|js)$/;
const NON_RUNTIME_COMPONENT_SUFFIX = /\.(?:d|spec|test|stories|story)$/;
const MAX_DISCOVERY_DIRECTORIES = 1_024;
const MAX_DISCOVERY_ENTRIES = 100_000;
const MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_COMPONENTS = 10_000;
const MAX_COMPONENT_SOURCE_BYTES = DEFAULT_MAX_FILE_SIZE_BYTES;
const MAX_DEFERRED_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_ERROR_MESSAGE_LENGTH = 4_096;
const REACT_COMPONENT_SYMBOLS = new Set([
  Symbol.for("react.forward_ref"),
  Symbol.for("react.lazy"),
  Symbol.for("react.memo"),
]);
const VERYFRONT_SYSTEM_DIRECTORIES = new Set([
  "cache",
  "compiled",
  "tmp",
  "temp",
  "output",
  "optimized-images",
  "css",
]);
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();

type ComponentFileType = "tsx" | "jsx" | "ts" | "js";

interface DeferredComponentSource {
  source: string;
  sourceBytes: number;
  filePath: string;
  projectRoot: string;
  fileType: ComponentFileType;
}

interface DiscoveredComponent extends DeferredComponentSource {
  name: string;
}

interface DirectoryWork {
  path: string;
  insideVeryfront: boolean;
}

interface DiscoveryBudget {
  directoriesVisited: number;
  entriesInspected: number;
  sourceBytes: number;
}

export interface FailedComponent {
  readonly name: string;
  readonly error: string;
  readonly filePath: string;
  readonly timestamp: number;
}

export interface ComponentRegistryOptions {
  adapter: RuntimeAdapter;
  projectDir: string;
  virtualModules?: VirtualModuleSystem;
  moduleServerUrl?: string;
  vendorBundleHash?: string;
  projectId?: string;
  contentSourceId?: string;
}

export class ComponentRegistry {
  private readonly adapter: RuntimeAdapter;
  private readonly projectDir: string;
  private readonly virtualModules: VirtualModuleSystem;
  private readonly moduleServerUrl?: string;
  private readonly vendorBundleHash?: string;
  private readonly projectId?: string;
  private readonly contentSourceId?: string;
  private readonly components = new Map<
    string,
    React.ComponentType<Record<string, unknown>>
  >();
  private readonly componentSources = new Map<string, DeferredComponentSource>();
  private readonly componentPaths = new Map<string, string>();
  private readonly failedComponents = new Map<string, FailedComponent>();
  private initialized = false;
  private retainedDeferredSourceBytes = 0;
  private lifecycleGeneration = 0;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: ComponentRegistryOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("Component registry options are required");
    }
    if (!options.adapter) {
      throw new TypeError("Component registry requires a runtime adapter");
    }
    assertSafePath(options.projectDir, "Component registry project directory");
    if (options.contentSourceId !== undefined) {
      assertSafeIdentity(
        options.contentSourceId,
        "Component registry content source ID",
      );
    }

    this.adapter = options.adapter;
    this.projectDir = normalizePath(options.projectDir);
    this.virtualModules = options.virtualModules ??
      new VirtualModuleSystem("/_veryfront/modules", options.adapter);
    this.moduleServerUrl = options.moduleServerUrl;
    this.vendorBundleHash = options.vendorBundleHash;
    this.projectId = options.projectId;
    this.contentSourceId = options.contentSourceId;
  }

  loadFromDirectory(dir: string, deferLoading = false): Promise<void> {
    const generation = this.lifecycleGeneration;
    return this.runExclusive(async () => {
      this.assertGeneration(generation);
      await this.loadDirectoryGeneration(dir, deferLoading, generation);
    });
  }

  get(name: string): React.ComponentType<Record<string, unknown>> | null {
    const component = this.components.get(name);
    if (component) return component;

    if (this.componentSources.has(name) && !this.initialized) {
      logger.warn(`Component ${name} requested before initialization complete`);
    }
    return null;
  }

  getAll(): Record<string, React.ComponentType<Record<string, unknown>>> {
    return Object.fromEntries(this.components);
  }

  getAllAsComponents(): Record<string, React.ComponentType<unknown>> {
    return Object.fromEntries(this.components) as Record<
      string,
      React.ComponentType<unknown>
    >;
  }

  has(name: string): boolean {
    return this.components.has(name);
  }

  getVirtualModuleSystem(): VirtualModuleSystem {
    return this.virtualModules;
  }

  clear(): void {
    this.lifecycleGeneration += 1;
    // Component modules are the only production writers to this registry's
    // virtual-module system. Clearing both sides prevents an in-flight scan
    // from leaving transformed modules visible without matching components.
    this.virtualModules.clear();
    this.components.clear();
    this.componentSources.clear();
    this.componentPaths.clear();
    this.failedComponents.clear();
    this.retainedDeferredSourceBytes = 0;
    this.initialized = false;
  }

  initializeComponents(): Promise<void> {
    const generation = this.lifecycleGeneration;
    return this.runExclusive(async () => {
      this.assertGeneration(generation);
      if (this.initialized) return;
      if (this.componentSources.size === 0) {
        this.initialized = true;
        return;
      }

      const loaderOptions = await this.getLoaderOptions();
      const loaded = new Map<
        string,
        React.ComponentType<Record<string, unknown>>
      >();

      for (const [componentName, info] of this.componentSources) {
        this.assertGeneration(generation);
        try {
          loaded.set(
            componentName,
            assertReactComponentType(
              await loadComponentFromSource(
                info.source,
                info.filePath,
                info.projectRoot,
                this.adapter,
                loaderOptions,
              ),
              info.filePath,
            ),
          );
        } catch (error) {
          const message = safeErrorMessage(error);
          this.failedComponents.set(
            componentName,
            Object.freeze({
              name: componentName,
              error: message,
              filePath: info.filePath,
              timestamp: Date.now(),
            }),
          );
          throw componentLoadError(componentName, info.filePath, error);
        }
      }

      await this.virtualModules.registerModules(
        Array.from(
          this.componentSources,
          ([componentName, info]): VirtualModuleRegistration => ({
            id: `component:${componentName}`,
            source: info.source,
            fileType: info.fileType,
          }),
        ),
        this.projectDir,
      );
      this.assertGeneration(generation);
      for (const [componentName, component] of loaded) {
        this.components.set(componentName, component);
        this.failedComponents.delete(componentName);
      }
      this.componentSources.clear();
      this.retainedDeferredSourceBytes = 0;
      this.initialized = true;
      logger.debug(`Initialized ${loaded.size} deferred components`);
    });
  }

  getFailedComponents(): FailedComponent[] {
    return Array.from(
      this.failedComponents.values(),
      (failure) => ({ ...failure }),
    );
  }

  hasFailed(name: string): boolean {
    return this.failedComponents.has(name);
  }

  private async loadDirectoryGeneration(
    dir: string,
    deferLoading: boolean,
    generation: number,
  ): Promise<void> {
    assertSafePath(dir, "Component directory");
    const normalizedDir = normalizePath(dir);
    if (!isWithinDirectory(this.projectDir, normalizedDir)) {
      throw new TypeError("Component directory is outside the configured project");
    }

    const discovered = await discoverComponents(
      normalizedDir,
      this.projectDir,
      this.adapter.fs,
    );
    this.assertGeneration(generation);
    if (discovered.length === 0) {
      logger.debug(`No components found in ${normalizedDir}`);
      return;
    }

    for (const component of discovered) {
      const existingPath = this.componentPaths.get(component.name);
      if (existingPath && existingPath !== component.filePath) {
        throw new Error(
          `Duplicate component name "${component.name}" for "${existingPath}" and "${component.filePath}"`,
        );
      }
    }
    const uniqueComponentCount = new Set([
      ...this.componentPaths.keys(),
      ...discovered.map((component) => component.name),
    ]).size;
    if (uniqueComponentCount > MAX_COMPONENTS) {
      throw new RangeError(
        `Component registry limit of ${MAX_COMPONENTS} was exceeded`,
      );
    }

    let projectedDeferredBytes = this.retainedDeferredSourceBytes;
    if (deferLoading) {
      for (const component of discovered) {
        projectedDeferredBytes -= this.componentSources.get(component.name)?.sourceBytes ?? 0;
        if (
          component.sourceBytes >
            MAX_DEFERRED_SOURCE_BYTES - projectedDeferredBytes
        ) {
          throw new RangeError(
            `Deferred component source byte limit of ${MAX_DEFERRED_SOURCE_BYTES} was exceeded`,
          );
        }
        projectedDeferredBytes += component.sourceBytes;
      }
    }

    const stagedComponents = new Map<
      string,
      React.ComponentType<Record<string, unknown>>
    >();
    if (!deferLoading) {
      const loaderOptions = await this.getLoaderOptions();
      for (const component of discovered) {
        this.assertGeneration(generation);
        try {
          stagedComponents.set(
            component.name,
            assertReactComponentType(
              await loadComponentFromSource(
                component.source,
                component.filePath,
                component.projectRoot,
                this.adapter,
                loaderOptions,
              ),
              component.filePath,
            ),
          );
        } catch (error) {
          throw componentLoadError(component.name, component.filePath, error);
        }
      }
    }

    if (!deferLoading) {
      const registrations: VirtualModuleRegistration[] = discovered.map(
        (component) => ({
          id: `component:${component.name}`,
          source: component.source,
          fileType: component.fileType,
        }),
      );
      await this.virtualModules.registerModules(registrations, this.projectDir);
      this.assertGeneration(generation);
    }

    for (const component of discovered) {
      this.componentPaths.set(component.name, component.filePath);
      this.failedComponents.delete(component.name);

      if (deferLoading) {
        this.components.delete(component.name);
        this.componentSources.set(component.name, component);
      } else {
        const previousSource = this.componentSources.get(component.name);
        if (previousSource) {
          this.retainedDeferredSourceBytes -= previousSource.sourceBytes;
          this.componentSources.delete(component.name);
        }
        this.components.set(component.name, stagedComponents.get(component.name)!);
      }
    }

    if (deferLoading) {
      this.retainedDeferredSourceBytes = projectedDeferredBytes;
      this.initialized = false;
    } else {
      this.initialized = this.componentSources.size === 0;
    }
    logger.debug(
      `Loaded ${discovered.length} component${
        discovered.length === 1 ? "" : "s"
      } from ${normalizedDir}`,
    );
  }

  private async getLoaderOptions(): Promise<LoadComponentOptions> {
    if (!this.contentSourceId) {
      throw new TypeError(
        "Component loading requires a content source ID for cache isolation",
      );
    }
    return {
      projectId: this.projectId ?? this.projectDir,
      dev: true,
      moduleServerUrl: this.moduleServerUrl,
      vendorBundleHash: this.vendorBundleHash,
      contentSourceId: this.contentSourceId,
      importMap: await this.virtualModules.getImportMap(this.projectDir),
    };
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.lifecycleGeneration) {
      throw new Error("Component registry operation was invalidated");
    }
  }
}

async function discoverComponents(
  rootDir: string,
  projectDir: string,
  fs: FileSystemAdapter,
): Promise<DiscoveredComponent[]> {
  const components: DiscoveredComponent[] = [];
  const componentPaths = new Map<string, string>();
  const work: DirectoryWork[] = [{ path: rootDir, insideVeryfront: false }];
  const budget: DiscoveryBudget = {
    directoriesVisited: 1,
    entriesInspected: 0,
    sourceBytes: 0,
  };
  let rootInspected = false;

  for (let workIndex = 0; workIndex < work.length; workIndex += 1) {
    const directory = work[workIndex]!;
    let entries: DirEntry[];
    try {
      entries = await readDirectoryEntries(directory.path, fs, budget);
    } catch (error) {
      if (!rootInspected && directory.path === rootDir && isNotFoundError(error)) {
        return [];
      }
      throw error;
    }

    if (!rootInspected) {
      rootInspected = true;
      await assertPhysicalContainment(projectDir, rootDir, fs);
    }

    for (const entry of entries) {
      if (entry.isSymlink) continue;
      if (entry.name === "node_modules") continue;
      if (entry.name.startsWith(".") && entry.name !== ".veryfront") continue;

      const entryPath = join(directory.path, entry.name);
      assertSafePath(entryPath, "Discovered component path");

      if (entry.isDirectory) {
        if (
          directory.insideVeryfront &&
          VERYFRONT_SYSTEM_DIRECTORIES.has(entry.name)
        ) {
          continue;
        }
        if (budget.directoriesVisited >= MAX_DISCOVERY_DIRECTORIES) {
          throw new RangeError(
            `Component directory limit of ${MAX_DISCOVERY_DIRECTORIES} was exceeded`,
          );
        }
        budget.directoriesVisited += 1;
        work.push({
          path: entryPath,
          insideVeryfront: directory.insideVeryfront ||
            entry.name === ".veryfront",
        });
        continue;
      }
      if (!entry.isFile) continue;

      const extension = COMPONENT_EXTENSION.exec(entry.name);
      if (!extension) continue;
      const componentName = extension[1]!;
      if (
        componentName === "index" ||
        NON_RUNTIME_COMPONENT_SUFFIX.test(componentName)
      ) {
        continue;
      }
      assertComponentName(componentName);

      const existingPath = componentPaths.get(componentName);
      if (existingPath && existingPath !== entryPath) {
        throw new Error(
          `Duplicate component name "${componentName}" for "${existingPath}" and "${entryPath}"`,
        );
      }
      if (components.length >= MAX_COMPONENTS) {
        throw new RangeError(
          `Component registry limit of ${MAX_COMPONENTS} was exceeded`,
        );
      }

      const source = await readComponentSource(entryPath, fs);
      if (
        source.sourceBytes >
          MAX_DEFERRED_SOURCE_BYTES - budget.sourceBytes
      ) {
        throw new RangeError(
          `Component discovery source byte limit of ${MAX_DEFERRED_SOURCE_BYTES} was exceeded`,
        );
      }
      budget.sourceBytes += source.sourceBytes;
      componentPaths.set(componentName, entryPath);
      components.push({
        name: componentName,
        fileType: extension[2] as ComponentFileType,
        filePath: entryPath,
        projectRoot: projectDir,
        ...source,
      });
    }
  }

  components.sort((left, right) => left.filePath.localeCompare(right.filePath));
  return components;
}

async function readDirectoryEntries(
  path: string,
  fs: FileSystemAdapter,
  budget: DiscoveryBudget,
): Promise<DirEntry[]> {
  const entries: DirEntry[] = [];
  for await (const rawEntry of fs.readDir(path)) {
    if (entries.length >= MAX_DIRECTORY_ENTRIES) {
      throw new RangeError(
        `Component directory entry limit of ${MAX_DIRECTORY_ENTRIES} was exceeded`,
      );
    }
    if (budget.entriesInspected >= MAX_DISCOVERY_ENTRIES) {
      throw new RangeError(
        `Component discovery entry limit of ${MAX_DISCOVERY_ENTRIES} was exceeded`,
      );
    }
    budget.entriesInspected += 1;
    entries.push(snapshotDirectoryEntry(rawEntry));
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  return entries;
}

function snapshotDirectoryEntry(value: unknown): DirEntry {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Component adapter returned an invalid directory entry");
  }

  const name = readEntryDataProperty(value, "name");
  const isFile = readEntryDataProperty(value, "isFile");
  const isDirectory = readEntryDataProperty(value, "isDirectory");
  const isSymlink = readEntryDataProperty(value, "isSymlink");
  if (
    typeof name !== "string" ||
    typeof isFile !== "boolean" ||
    typeof isDirectory !== "boolean" ||
    typeof isSymlink !== "boolean" ||
    (isFile && isDirectory) ||
    !isSafeDirectoryEntryName(name)
  ) {
    throw new TypeError("Component adapter returned an invalid directory entry");
  }
  return { name, isFile, isDirectory, isSymlink };
}

function readEntryDataProperty(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("Directory entry must use own data properties");
    }
    return descriptor.value;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Component directory entry could not be inspected");
  }
}

async function readComponentSource(
  filePath: string,
  fs: FileSystemAdapter,
): Promise<{ source: string; sourceBytes: number }> {
  if (typeof fs.readFileBytesBounded === "function") {
    const bytes = await fs.readFileBytesBounded(
      filePath,
      MAX_COMPONENT_SOURCE_BYTES + 1,
    );
    assertSourceSize(bytes.byteLength);
    try {
      return {
        source: strictUtf8Decoder.decode(bytes),
        sourceBytes: bytes.byteLength,
      };
    } catch {
      throw new TypeError(`Component source "${filePath}" must be valid UTF-8`);
    }
  }

  const info = await fs.stat(filePath);
  if (Number.isFinite(info.size)) assertSourceSize(info.size);
  const source = await fs.readFile(filePath);
  const sourceBytes = utf8Encoder.encode(source).byteLength;
  assertSourceSize(sourceBytes);
  return { source, sourceBytes };
}

async function assertPhysicalContainment(
  projectDir: string,
  rootDir: string,
  fs: FileSystemAdapter,
): Promise<void> {
  if (typeof fs.realPath !== "function") return;
  const [physicalProjectDir, physicalRootDir] = await Promise.all([
    fs.realPath(projectDir),
    fs.realPath(rootDir),
  ]);
  if (!isWithinDirectory(physicalProjectDir, physicalRootDir)) {
    throw new TypeError(
      "Component directory resolves outside the configured project",
    );
  }
}

function assertSourceSize(size: number): void {
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > MAX_COMPONENT_SOURCE_BYTES
  ) {
    throw new RangeError(
      `Component source byte limit of ${MAX_COMPONENT_SOURCE_BYTES} was exceeded`,
    );
  }
}

function assertSafePath(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    containsPathControlCharacters(value)
  ) {
    throw new TypeError(
      `${label} must be a non-empty path of at most ${MAX_PATH_LENGTH_CHARS} characters without control characters`,
    );
  }
}

function isSafeDirectoryEntryName(name: string): boolean {
  return name.length > 0 &&
    name.length <= MAX_PATH_LENGTH_CHARS &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !containsPathControlCharacters(name);
}

function assertComponentName(name: string): void {
  if (
    name.length === 0 ||
    name.length > MAX_PATH_LENGTH_CHARS ||
    containsPathControlCharacters(name)
  ) {
    throw new TypeError("Component filename does not produce a safe component name");
  }
}

function assertSafeIdentity(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    containsPathControlCharacters(value)
  ) {
    throw new TypeError(
      `${label} must contain between 1 and ${MAX_PATH_LENGTH_CHARS} characters without control characters`,
    );
  }
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown component loading error";
  return error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function assertReactComponentType(
  value: unknown,
  filePath: string,
): React.ComponentType<Record<string, unknown>> {
  if (typeof value === "function") {
    return value as React.ComponentType<Record<string, unknown>>;
  }
  if (typeof value === "object" && value !== null) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, "$$typeof");
      if (
        descriptor &&
        Object.hasOwn(descriptor, "value") &&
        typeof descriptor.value === "symbol" &&
        REACT_COMPONENT_SYMBOLS.has(descriptor.value)
      ) {
        return value as React.ComponentType<Record<string, unknown>>;
      }
    } catch {
      // The generic invalid-export error below is deterministic and does not
      // expose proxy traps or arbitrary stringification.
    }
  }
  throw new TypeError(`Module "${filePath}" did not export a React component`);
}

function componentLoadError(
  componentName: string,
  filePath: string,
  cause: unknown,
): Error {
  return new Error(
    `Failed to load component "${componentName}" from "${filePath}": ${safeErrorMessage(cause)}`,
    { cause },
  );
}
