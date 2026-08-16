import { dirname, join } from "#veryfront/compat/path";
import { DEFAULT_DASHBOARD_PORT, rendererLogger as logger } from "#veryfront/utils";
import * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { VirtualModuleSystem } from "../virtual-module-system.ts";
import { loadComponentFromSource } from "#veryfront/modules/react-loader/component-loader.ts";
import {
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
  resolveDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import type { LoadComponentOptions } from "#veryfront/modules/react-loader/types.ts";
import { buildServerExternalPackagesIdentity } from "#veryfront/config/server-external-packages.ts";
import { hashString } from "#veryfront/cache/hash.ts";

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

const COMPONENT_DEPENDENCY_SNAPSHOT_MAX_ENTRIES = 32;

type ComponentSourceLoader = (
  source: string,
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: LoadComponentOptions,
) => Promise<React.ComponentType<Record<string, unknown>>>;

function createErrorFallbackComponent(
  componentName: string,
  error: string,
): React.ComponentType<Record<string, unknown>> {
  const ErrorFallback: React.FC<Record<string, unknown>> = () => {
    const isDev = getEnv("NODE_ENV") === "development";
    if (!isDev) return React.createElement(React.Fragment);

    return React.createElement(
      "div",
      {
        style: {
          padding: "16px",
          margin: "8px 0",
          backgroundColor: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: "8px",
          fontFamily: "system-ui, sans-serif",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            fontWeight: "600",
            color: "#991b1b",
            marginBottom: "8px",
          },
        },
        `⚠️ Component "${componentName}" failed to load`,
      ),
      React.createElement(
        "pre",
        {
          style: {
            fontSize: "12px",
            color: "#7f1d1d",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
          },
        },
        error,
      ),
    );
  };

  ErrorFallback.displayName = `ErrorFallback(${componentName})`;
  return ErrorFallback;
}

export class ComponentRegistry {
  private components = new Map<string, React.ComponentType<Record<string, unknown>>>();
  private componentsByDependencySnapshot = new Map<
    string,
    Map<string, React.ComponentType<Record<string, unknown>>>
  >();
  private dependencySnapshotGenerations = new Map<string, number>();
  private dependencySnapshotLoads = new Map<string, Promise<void>>();
  private virtualModules: VirtualModuleSystem;
  private componentSources = new Map<string, DeferredComponentSource>();
  private failedComponents = new Map<string, FailedComponent>();
  private initialized = false;
  private projectDir = "";
  private serverPort: number;
  private adapter?: RuntimeAdapter;
  private moduleServerUrl?: string;
  private vendorBundleHash?: string;
  private projectId?: string;
  private contentSourceId?: string;
  private componentSourceGeneration = 0;
  private componentSourceLoader: ComponentSourceLoader;

  constructor(
    virtualModules?: VirtualModuleSystem,
    serverPort: number = DEFAULT_DASHBOARD_PORT,
    adapter?: RuntimeAdapter,
    moduleServerUrl?: string,
    vendorBundleHash?: string,
    projectId?: string,
    contentSourceId?: string,
    componentSourceLoader: ComponentSourceLoader = loadComponentFromSource,
  ) {
    this.virtualModules = virtualModules ?? new VirtualModuleSystem();
    this.serverPort = serverPort;
    this.adapter = adapter;
    this.moduleServerUrl = moduleServerUrl;
    this.vendorBundleHash = vendorBundleHash;
    this.projectId = projectId;
    this.contentSourceId = contentSourceId;
    this.componentSourceLoader = componentSourceLoader;
  }

  async loadFromDirectory(dir: string, deferLoading = false): Promise<void> {
    const actualProjectRoot = dir.endsWith("/components") || dir.endsWith("\\components")
      ? dirname(dir)
      : dir;

    this.projectDir ||= actualProjectRoot;

    try {
      const processed = await this.collectComponents(dir, actualProjectRoot, deferLoading);
      if (!deferLoading) await this.prepareDependencySnapshot();
      logger.debug(`Loaded ${processed} component${processed === 1 ? "" : "s"} from ${dir}`);
    } catch (error) {
      logger.debug(`Components directory not found: ${dir}`, error);
    }
  }

  get(
    name: string,
    dependencyPinningCacheKey?: string,
  ): React.ComponentType<Record<string, unknown>> | null {
    const components = this.getDependencySnapshotComponents(dependencyPinningCacheKey);
    const component = components?.get(name);
    if (component) return component;

    if (this.componentSources.has(name) && !this.initialized) {
      logger.warn(`Component ${name} requested before initialization complete`);
    }

    return null;
  }

  getAll(
    dependencyPinningCacheKey?: string,
  ): Record<string, React.ComponentType<Record<string, unknown>>> {
    const components = this.getDependencySnapshotComponents(dependencyPinningCacheKey);
    return Object.fromEntries(components ?? []);
  }

  getAllAsComponents(
    dependencyPinningCacheKey?: string,
  ): Record<string, React.ComponentType<unknown>> {
    return this.getAll(dependencyPinningCacheKey) as Record<
      string,
      React.ComponentType<unknown>
    >;
  }

  has(name: string, dependencyPinningCacheKey?: string): boolean {
    return this.getDependencySnapshotComponents(dependencyPinningCacheKey)?.has(name) === true;
  }

  getVirtualModuleSystem(): VirtualModuleSystem {
    return this.virtualModules;
  }

  clear(): void {
    this.components.clear();
    this.componentsByDependencySnapshot.clear();
    this.dependencySnapshotGenerations.clear();
    this.dependencySnapshotLoads.clear();
    this.componentSources.clear();
    this.failedComponents.clear();
    this.initialized = false;
    this.componentSourceGeneration = 0;
  }

  async initializeComponents(): Promise<void> {
    await this.prepareDependencySnapshot();
  }

  /**
   * Materialize the retained component sources for one immutable dependency
   * snapshot. Snapshot-specific maps avoid reusing component objects compiled
   * under package state A during a later or concurrent state-B render.
   */
  async prepareDependencySnapshot(
    dependencyPinningCacheKey?: string,
    dependencyPinningDependencies?: Readonly<Record<string, string>>,
    dependencyPinningSource?: DependencyPinningSourceInput,
    moduleServerOrigin?: string,
    serverExternalPackages?: readonly string[],
  ): Promise<string> {
    const dependencySnapshot = await resolveDependencyPinningSnapshot(
      (dependencyPinningSource ?? this.projectDir) || undefined,
      dependencyPinningCacheKey,
      dependencyPinningDependencies,
    );
    let snapshotKey = dependencySnapshot.cacheKey.startsWith("on:") && moduleServerOrigin
      ? `${dependencySnapshot.cacheKey}:origin:${encodeURIComponent(moduleServerOrigin)}`
      : dependencySnapshot.cacheKey;
    const serverExternalPackagesIdentity = buildServerExternalPackagesIdentity(
      serverExternalPackages,
    );
    if (serverExternalPackagesIdentity) {
      snapshotKey += `:server-externals:${hashString(serverExternalPackagesIdentity)}`;
    }
    const sourceGeneration = this.componentSourceGeneration;
    if (
      this.dependencySnapshotGenerations.get(snapshotKey) === sourceGeneration
    ) {
      this.touchDependencySnapshot(snapshotKey);
      this.components = this.componentsByDependencySnapshot.get(snapshotKey) ?? new Map();
      this.initialized = true;
      return snapshotKey;
    }

    const loadKey = `${snapshotKey}\0${sourceGeneration}`;
    const activeLoad = this.dependencySnapshotLoads.get(loadKey);
    if (activeLoad) {
      await activeLoad;
      return snapshotKey;
    }

    const load = this.loadDependencySnapshot(
      dependencySnapshot,
      snapshotKey,
      sourceGeneration,
      dependencyPinningSource,
      moduleServerOrigin,
      serverExternalPackages,
    ).finally(() => {
      if (this.dependencySnapshotLoads.get(loadKey) === load) {
        this.dependencySnapshotLoads.delete(loadKey);
      }
      this.trimDependencySnapshots();
    });
    this.dependencySnapshotLoads.set(loadKey, load);
    await load;
    return snapshotKey;
  }

  private async loadDependencySnapshot(
    dependencySnapshot: DependencyPinningSnapshot,
    snapshotKey: string,
    sourceGeneration: number,
    dependencyPinningSource?: DependencyPinningSourceInput,
    moduleServerOrigin?: string,
    serverExternalPackages?: readonly string[],
  ): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) {
      logger.warn("Component registry adapter unavailable; skipping initialization");
      return;
    }

    logger.debug(`Initializing ${this.componentSources.size} deferred components`);

    const components = new Map<string, React.ComponentType<Record<string, unknown>>>();
    let successCount = 0;
    let failCount = 0;

    for (const [componentName, info] of this.componentSources) {
      try {
        const Component = await this.componentSourceLoader(
          info.source,
          info.filePath,
          info.projectRoot,
          adapter,
          this.getLoaderOptions(
            info.projectRoot,
            dependencySnapshot,
            dependencyPinningSource,
            moduleServerOrigin,
            serverExternalPackages,
          ),
        );

        components.set(componentName, Component);
        this.failedComponents.delete(componentName);
        successCount++;
        logger.debug(`Successfully loaded component: ${componentName}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        failCount++;

        this.failedComponents.set(componentName, {
          name: componentName,
          error: errorMessage,
          filePath: info.filePath,
          timestamp: Date.now(),
        });

        components.set(
          componentName,
          createErrorFallbackComponent(componentName, errorMessage),
        );

        logger.debug(`Failed to load component ${componentName}, using fallback`, {
          error: errorMessage,
          filePath: info.filePath,
        });
      }
    }

    this.componentsByDependencySnapshot.set(
      snapshotKey,
      components,
    );
    this.dependencySnapshotGenerations.set(
      snapshotKey,
      sourceGeneration,
    );
    this.touchDependencySnapshot(snapshotKey);
    this.trimDependencySnapshots();
    this.components = components;
    this.initialized = true;

    if (failCount > 0) {
      logger.warn(
        `Component initialization complete: ${successCount} succeeded, ${failCount} failed (using fallbacks, set LOG_LEVEL=debug for details)`,
      );
      return;
    }

    logger.debug(`Component initialization complete: ${successCount} components loaded`);
  }

  private touchDependencySnapshot(snapshotKey: string): void {
    const components = this.componentsByDependencySnapshot.get(snapshotKey);
    const generation = this.dependencySnapshotGenerations.get(snapshotKey);
    if (!components || generation === undefined) return;

    this.componentsByDependencySnapshot.delete(snapshotKey);
    this.componentsByDependencySnapshot.set(snapshotKey, components);
    this.dependencySnapshotGenerations.delete(snapshotKey);
    this.dependencySnapshotGenerations.set(snapshotKey, generation);
  }

  private getDependencySnapshotComponents(
    snapshotKey?: string,
  ): Map<string, React.ComponentType<Record<string, unknown>>> | undefined {
    if (!snapshotKey) return this.components;
    const components = this.componentsByDependencySnapshot.get(snapshotKey);
    if (components) this.touchDependencySnapshot(snapshotKey);
    return components;
  }

  private trimDependencySnapshots(): void {
    while (
      this.componentsByDependencySnapshot.size >
        COMPONENT_DEPENDENCY_SNAPSHOT_MAX_ENTRIES
    ) {
      let evicted = false;
      for (const snapshotKey of this.componentsByDependencySnapshot.keys()) {
        const activeLoadPrefix = `${snapshotKey}\0`;
        const isLoading = [...this.dependencySnapshotLoads.keys()].some((loadKey) =>
          loadKey.startsWith(activeLoadPrefix)
        );
        if (isLoading) continue;

        this.componentsByDependencySnapshot.delete(snapshotKey);
        this.dependencySnapshotGenerations.delete(snapshotKey);
        evicted = true;
        break;
      }
      if (!evicted) break;
    }
  }

  getFailedComponents(): FailedComponent[] {
    return Array.from(this.failedComponents.values());
  }

  hasFailed(name: string): boolean {
    return this.failedComponents.has(name);
  }

  private getLoaderOptions(
    projectRoot: string,
    dependencySnapshot?: DependencyPinningSnapshot,
    dependencyPinningSource?: DependencyPinningSourceInput,
    moduleServerOrigin?: string,
    serverExternalPackages?: readonly string[],
  ): LoadComponentOptions {
    return {
      projectId: this.projectId ?? projectRoot,
      dev: true,
      moduleServerUrl: this.moduleServerUrl,
      vendorBundleHash: this.vendorBundleHash,
      contentSourceId: this.contentSourceId,
      moduleServerOrigin,
      dependencyPinningCacheKey: dependencySnapshot?.cacheKey,
      dependencyPinningDependencies: dependencySnapshot?.dependencies,
      dependencyPinningSource,
      serverExternalPackages,
    };
  }

  private async collectComponents(
    dir: string,
    projectRoot: string,
    deferLoading: boolean,
  ): Promise<number> {
    const adapter = this.adapter;
    const readDir = adapter?.fs.readDir;
    if (!readDir) return 0;

    let count = 0;
    let failureCount = 0;

    for await (const entry of readDir(dir)) {
      const entryPath = join(dir, entry.name);

      if (entry.name === "node_modules") continue;
      if (entry.name.startsWith(".") && entry.name !== ".veryfront") continue;

      if (
        dir.includes(".veryfront") &&
        ["cache", "compiled", "tmp", "temp", "output", "optimized-images", "css"].includes(
          entry.name,
        )
      ) {
        continue;
      }

      if (entry.isDirectory) {
        count += await this.collectComponents(entryPath, projectRoot, deferLoading);
        continue;
      }

      if (!(entry.isFile || entry.isSymlink) || !/\.(tsx|jsx|ts|js)$/.test(entry.name)) continue;

      const extMatch = /\.(tsx|jsx|ts|js)$/.exec(entry.name);
      const fileType = extMatch?.[1] as "tsx" | "jsx" | "ts" | "js" | undefined;
      const componentName = entry.name.replace(/\.(tsx|jsx|ts|js)$/, "");
      if (componentName === "index") continue;

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

        const previousSource = this.componentSources.get(componentName);
        if (
          previousSource?.source !== fileContent ||
          previousSource.filePath !== entryPath ||
          previousSource.projectRoot !== projectRoot
        ) {
          this.componentSources.set(componentName, {
            source: fileContent,
            filePath: entryPath,
            projectRoot,
          });
          this.componentSourceGeneration++;
        }

        if (deferLoading) {
          logger.debug(`Stored component source for deferred loading: ${componentName}`);
        }

        count++;
      } catch (error) {
        failureCount++;
        logger.debug(`Failed to process component ${componentName}`, {
          filePath: entryPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (failureCount > 0) {
      const relativeDir = dir.startsWith(projectRoot) ? dir.slice(projectRoot.length + 1) : dir;
      logger.warn(
        `Component scan: ${failureCount} failure${
          failureCount === 1 ? "" : "s"
        } (set LOG_LEVEL=debug for details)`,
        { dir: relativeDir },
      );
    }

    return count;
  }
}
