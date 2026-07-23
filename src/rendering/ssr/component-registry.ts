import { dirname, isAbsolute, join, relative } from "#veryfront/compat/path";
import { DEFAULT_DASHBOARD_PORT, rendererLogger as logger } from "#veryfront/utils";
import type * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { VirtualModuleSystem } from "../virtual-module-system.ts";
import { loadComponentFromSource } from "#veryfront/modules/react-loader/component-loader.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";

interface DeferredComponentSource {
  source: string;
  filePath: string;
  projectRoot: string;
}

interface FailedComponent {
  name: string;
  error: string;
  filePath: string;
  timestamp: number;
}

const MAX_COMPONENT_ENTRIES = 10_000;
const MAX_COMPONENT_DEPTH = 64;

interface ComponentScanState {
  readonly root: string;
  readonly canonicalRoot?: string;
  entries: number;
}

export class ComponentRegistry {
  private components = new Map<string, React.ComponentType<Record<string, unknown>>>();
  private virtualModules: VirtualModuleSystem;
  private componentSources = new Map<string, DeferredComponentSource>();
  private componentPaths = new Map<string, string>();
  private failedComponents = new Map<string, FailedComponent>();
  private initialized = false;
  private initializationPromise?: Promise<void>;
  private generation = 0;
  private projectDir = "";
  private serverPort: number;
  private adapter?: RuntimeAdapter;
  private moduleServerUrl?: string;
  private vendorBundleHash?: string;
  private projectId?: string;
  private contentSourceId?: string;
  private dev: boolean;

  constructor(
    virtualModules?: VirtualModuleSystem,
    serverPort: number = DEFAULT_DASHBOARD_PORT,
    adapter?: RuntimeAdapter,
    moduleServerUrl?: string,
    vendorBundleHash?: string,
    projectId?: string,
    contentSourceId?: string,
    dev = false,
  ) {
    if (!virtualModules && !adapter) {
      throw new TypeError("ComponentRegistry requires a RuntimeAdapter or VirtualModuleSystem");
    }
    this.virtualModules = virtualModules ??
      new VirtualModuleSystem("/_veryfront/modules", adapter!);
    this.serverPort = serverPort;
    this.adapter = adapter;
    this.moduleServerUrl = moduleServerUrl;
    this.vendorBundleHash = vendorBundleHash;
    this.projectId = projectId;
    this.contentSourceId = contentSourceId;
    this.dev = dev;
  }

  async loadFromDirectory(dir: string, deferLoading = false): Promise<void> {
    const actualProjectRoot = dir.endsWith("/components") || dir.endsWith("\\components")
      ? dirname(dir)
      : dir;

    this.projectDir ||= actualProjectRoot;

    if (!isPathWithin(actualProjectRoot, dir)) {
      throw new TypeError("Component directory must stay within its project root");
    }

    try {
      const fs = this.requireAdapter().fs;
      if (fs.lstat && (await fs.lstat(dir)).isSymlink) {
        throw new TypeError("Component directory cannot be a symbolic link");
      }
      const canonicalRoot = fs.realPath ? await fs.realPath(dir) : undefined;
      const processed = await this.collectComponents(
        dir,
        actualProjectRoot,
        deferLoading,
        { root: dir, canonicalRoot, entries: 0 },
        0,
      );
      logger.debug("Component directory loaded", { componentCount: processed });
    } catch (error) {
      if (isNotFoundError(error)) return;
      throw error;
    }
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
    return Object.fromEntries(this.components) as Record<string, React.ComponentType<unknown>>;
  }

  has(name: string): boolean {
    return this.components.has(name);
  }

  getVirtualModuleSystem(): VirtualModuleSystem {
    return this.virtualModules;
  }

  clear(): void {
    this.components.clear();
    this.componentSources.clear();
    this.componentPaths.clear();
    this.failedComponents.clear();
    this.virtualModules.clear();
    this.initialized = false;
    this.generation++;
    this.initializationPromise = undefined;
  }

  async initializeComponents(): Promise<void> {
    if (this.initialized) return;
    if (this.initializationPromise) return await this.initializationPromise;

    const generation = this.generation;
    const promise = this.initializeComponentsInternal(generation).finally(() => {
      if (this.initializationPromise === promise) this.initializationPromise = undefined;
    });
    this.initializationPromise = promise;
    return await promise;
  }

  private async initializeComponentsInternal(generation: number): Promise<void> {
    const adapter = this.requireAdapter();
    const pendingComponents = [...this.componentSources.entries()];
    const loadedComponents = new Map<string, React.ComponentType<Record<string, unknown>>>();

    logger.debug("Initializing deferred components", { componentCount: pendingComponents.length });

    let successCount = 0;
    let failCount = 0;

    for (const [componentName, info] of pendingComponents) {
      if (generation !== this.generation) return;
      try {
        const Component = await loadComponentFromSource(
          info.source,
          info.filePath,
          info.projectRoot,
          adapter,
          this.getLoaderOptions(info.projectRoot),
        );

        loadedComponents.set(componentName, Component);
        successCount++;
        logger.debug("Deferred component loaded", { componentName });
      } catch (error) {
        const errorMessage = sanitizeErrorText(
          error instanceof Error ? error.message : String(error),
          1_024,
        );
        failCount++;

        if (generation !== this.generation) return;
        this.failedComponents.set(componentName, {
          name: componentName,
          error: errorMessage,
          filePath: toProjectRelativePath(info.projectRoot, info.filePath),
          timestamp: Date.now(),
        });
        logger.debug("Deferred component failed to load", {
          componentName,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }

    if (failCount > 0) {
      throw new AggregateError(
        this.getFailedComponents().map((failure) => new Error(failure.error)),
        `Component initialization failed for ${failCount} component${failCount === 1 ? "" : "s"}`,
      );
    }

    if (generation !== this.generation) return;
    for (const [componentName, component] of loadedComponents) {
      this.components.set(componentName, component);
      this.failedComponents.delete(componentName);
    }
    this.componentSources.clear();
    this.initialized = true;
    logger.debug("Component initialization complete", { componentCount: successCount });
  }

  getFailedComponents(): FailedComponent[] {
    return Array.from(this.failedComponents.values());
  }

  hasFailed(name: string): boolean {
    return this.failedComponents.has(name);
  }

  private getLoaderOptions(projectRoot: string): {
    projectId: string;
    dev: boolean;
    moduleServerUrl?: string;
    vendorBundleHash?: string;
    contentSourceId?: string;
  } {
    return {
      projectId: this.projectId ?? projectRoot,
      dev: this.dev,
      moduleServerUrl: this.moduleServerUrl,
      vendorBundleHash: this.vendorBundleHash,
      contentSourceId: this.contentSourceId,
    };
  }

  private async collectComponents(
    dir: string,
    projectRoot: string,
    deferLoading: boolean,
    state: ComponentScanState,
    depth: number,
  ): Promise<number> {
    if (depth > MAX_COMPONENT_DEPTH) {
      throw new RangeError("Component directory depth exceeds the supported limit");
    }

    const adapter = this.requireAdapter();
    const entries = [];
    for await (const entry of adapter.fs.readDir(dir)) entries.push(entry);
    entries.sort((a, b) => a.name.localeCompare(b.name));

    let count = 0;

    for (const entry of entries) {
      validateEntryName(entry.name);
      if (entry.isSymlink) continue;

      state.entries++;
      if (state.entries > MAX_COMPONENT_ENTRIES) {
        throw new RangeError("Component directory contains too many entries");
      }

      const entryPath = join(dir, entry.name);
      if (!isPathWithin(state.root, entryPath)) {
        throw new TypeError("Component entry escaped the configured directory");
      }

      if (adapter.fs.lstat && (await adapter.fs.lstat(entryPath)).isSymlink) continue;
      if (adapter.fs.realPath && state.canonicalRoot) {
        const canonicalPath = await adapter.fs.realPath(entryPath);
        if (!isPathWithin(state.canonicalRoot, canonicalPath)) continue;
      }

      if (entry.name === "node_modules") continue;
      if (entry.name.startsWith(".") && entry.name !== ".veryfront") continue;

      if (
        isInsideVeryfrontDirectory(projectRoot, dir) &&
        ["cache", "compiled", "tmp", "temp", "output", "optimized-images", "css"].includes(
          entry.name,
        )
      ) {
        continue;
      }

      if (entry.isDirectory) {
        count += await this.collectComponents(
          entryPath,
          projectRoot,
          deferLoading,
          state,
          depth + 1,
        );
        continue;
      }

      if (!entry.isFile || !/\.(tsx|jsx|ts|js)$/.test(entry.name)) continue;

      const extMatch = /\.(tsx|jsx|ts|js)$/.exec(entry.name);
      const fileType = extMatch?.[1] as "tsx" | "jsx" | "ts" | "js" | undefined;
      const componentName = entry.name
        .replace(/\.(tsx|jsx|ts|js)$/, "")
        .replace(/\.(client|server)$/, "");
      if (componentName === "index") continue;
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,255}$/.test(componentName)) {
        throw new TypeError("Component file name cannot be represented as a module identifier");
      }

      const existingPath = this.componentPaths.get(componentName);
      if (existingPath && existingPath !== entryPath) {
        throw new Error(`Duplicate component name "${componentName}"`);
      }

      try {
        const fileContent = await adapter.fs.readFile(entryPath);

        // Pass fileType explicitly so the virtual module system does not have
        // to guess the loader from source content heuristics.
        await this.virtualModules.registerModule(
          `component:${componentName}`,
          fileContent,
          dir,
          fileType,
        );

        if (deferLoading) {
          this.componentSources.set(componentName, {
            source: fileContent,
            filePath: entryPath,
            projectRoot,
          });
          this.generation++;
          this.initialized = false;
          logger.debug("Stored component source for deferred loading", { componentName });
        } else {
          const Component = await loadComponentFromSource(
            fileContent,
            entryPath,
            projectRoot,
            adapter,
            this.getLoaderOptions(projectRoot),
          );

          this.components.set(componentName, Component);
          logger.debug("Loaded component immediately", { componentName });
        }

        this.componentPaths.set(componentName, entryPath);
        count++;
      } catch (error) {
        this.failedComponents.set(componentName, {
          name: componentName,
          error: sanitizeErrorText(
            error instanceof Error ? error.message : String(error),
            1_024,
          ),
          filePath: toProjectRelativePath(projectRoot, entryPath),
          timestamp: Date.now(),
        });
        throw error;
      }
    }

    return count;
  }

  private requireAdapter(): RuntimeAdapter {
    if (!this.adapter) throw new TypeError("ComponentRegistry requires a RuntimeAdapter");
    return this.adapter;
  }
}

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate).replaceAll("\\", "/");
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}

function isInsideVeryfrontDirectory(projectRoot: string, dir: string): boolean {
  if (!isPathWithin(projectRoot, dir)) return false;
  return relative(projectRoot, dir).replaceAll("\\", "/").split("/").includes(".veryfront");
}

function toProjectRelativePath(projectRoot: string, path: string): string {
  const relativePath = relative(projectRoot, path).replaceAll("\\", "/");
  return isPathWithin(projectRoot, path) ? relativePath : "<OUTSIDE_PROJECT>";
}

function validateEntryName(name: string): void {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new TypeError("Component directory contains an invalid entry name");
  }
  for (const character of name) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      throw new TypeError("Component directory contains an invalid entry name");
    }
  }
}
