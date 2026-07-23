import { serverLogger as logger } from "#veryfront/utils";
import { basename, isAbsolute, join, normalize } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type * as React from "react";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { loadComponentFromSource } from "#veryfront/modules/react-loader/component-loader.ts";
import { clearSSRModuleCacheForProject } from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
import { COMPONENT_ERROR, INVALID_ARGUMENT, SERVICE_OVERLOADED } from "#veryfront/errors";
import { isReactComponent } from "#veryfront/modules/react-loader/extract-component.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const MAX_COMPONENTS = 10_000;
const MAX_DISCOVERY_ENTRIES = 100_000;
const MAX_DISCOVERY_DEPTH = 64;
const MAX_COMPONENT_SOURCE_BYTES = 5 * 1024 * 1024;
const LOAD_BATCH_SIZE = 20;
const MAX_COMPONENT_DIRS = 64;
const MAX_COMPONENT_PATH_LENGTH = 4_096;
const MAX_COMPONENT_NAME_LENGTH = 255;

function isValidComponentName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_COMPONENT_NAME_LENGTH &&
    name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\") &&
    !hasUnsafeControlCharacters(name);
}

function normalizeComponentDirectory(directory: string): string {
  if (
    directory.length === 0 || directory.length > MAX_COMPONENT_PATH_LENGTH ||
    hasUnsafeControlCharacters(directory) || isAbsolute(directory)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Component directory is invalid" });
  }
  const normalized = normalize(directory);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw INVALID_ARGUMENT.create({ detail: "Component directory must stay inside the project" });
  }
  return normalized;
}

function cloneComponentInfo(info: ComponentInfo): ComponentInfo {
  return {
    ...info,
    exports: info.exports ? { ...info.exports } : undefined,
  };
}

export interface ComponentExports {
  default?: unknown;
  [key: string]: unknown;
}

export interface ComponentInfo {
  name: string;
  path: string;
  content?: string;
  isLoaded: boolean;
  exports?: ComponentExports;
}

export interface ComponentRegistryOptions {
  projectDir: string;
  projectId?: string;
  componentDirs?: string[];
  adapter: RuntimeAdapter;
  moduleServerUrl?: string;
  vendorBundleHash?: string;
}

export type ComponentLoader = {
  loadComponent: (componentName: string, source: string, projectDir: string) => Promise<unknown>;
  clearCache: () => void;
};

export class ComponentRegistry {
  private components = new Map<string, ComponentInfo>();
  private componentDirs: string[];
  private initializedPromise: Promise<void> | null = null;
  private readonly loadingComponents = new Map<string, Promise<ComponentInfo | null>>();
  private adapter: RuntimeAdapter;
  private generation = 0;
  private componentLoader: ComponentLoader | null = null;

  constructor(private options: ComponentRegistryOptions) {
    if (
      options.projectDir.length === 0 || options.projectDir.length > MAX_COMPONENT_PATH_LENGTH ||
      hasUnsafeControlCharacters(options.projectDir)
    ) {
      throw INVALID_ARGUMENT.create({ detail: "Component project directory is invalid" });
    }
    this.adapter = options.adapter;
    const componentDirs = options.componentDirs ?? [
      "components",
      "islands",
      "src/components",
      "src/islands",
    ];
    if (componentDirs.length > MAX_COMPONENT_DIRS) {
      throw INVALID_ARGUMENT.create({
        detail: `Component directory count exceeds ${MAX_COMPONENT_DIRS}`,
      });
    }
    this.componentDirs = Array.from(
      new Set(componentDirs.map(normalizeComponentDirectory)),
    );
  }

  discover(): Promise<void> {
    if (this.initializedPromise) return this.initializedPromise;

    const generation = this.generation;
    const promise = withSpan(
      "modules.componentRegistry.discover",
      async () => {
        const discovered = await this._discoverInternal();
        if (this.generation === generation) {
          for (const [name, component] of this.components) {
            if (component.path.startsWith("virtual:")) discovered.set(name, component);
          }
          this.components = discovered;
        }
      },
      {},
    );
    this.initializedPromise = promise;
    void promise.then(
      () => {
        if (this.initializedPromise === promise) this.initializedPromise = null;
      },
      () => {
        if (this.initializedPromise === promise) this.initializedPromise = null;
      },
    );
    return promise;
  }

  private async _discoverInternal(): Promise<Map<string, ComponentInfo>> {
    const discovered = new Map<string, ComponentInfo>();
    const budget = { entries: 0 };

    for (const dir of this.componentDirs) {
      const fullPath = join(this.options.projectDir, dir);

      try {
        await this.walkDirectory(fullPath, discovered, 0, budget);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        const isNotFound = code === "ENOENT" ||
          (error instanceof Error && error.name === "NotFound");
        if (isNotFound) continue;

        logger.warn("Component discovery failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        throw error;
      }
    }

    logger.debug("Component discovery complete", { componentCount: discovered.size });
    return discovered;
  }

  private async walkDirectory(
    dir: string,
    discovered: Map<string, ComponentInfo>,
    depth: number,
    budget: { entries: number },
  ): Promise<void> {
    if (depth > MAX_DISCOVERY_DEPTH) {
      throw new RangeError("Component discovery depth limit exceeded");
    }
    const entries = this.adapter.fs.readDir(dir);

    for await (const entry of entries) {
      budget.entries++;
      if (budget.entries > MAX_DISCOVERY_ENTRIES) {
        throw SERVICE_OVERLOADED.create({
          detail: `Component discovery exceeds ${MAX_DISCOVERY_ENTRIES} entries`,
        });
      }
      if (!isValidComponentName(entry.name)) {
        throw COMPONENT_ERROR.create({ detail: "Component directory entry name is invalid" });
      }
      if (
        entry.name === "node_modules" ||
        entry.name.includes(".test.") ||
        entry.name.includes(".spec.")
      ) {
        continue;
      }

      const fullPath = join(dir, entry.name);

      if (entry.isSymlink) continue;

      if (entry.isDirectory) {
        await this.walkDirectory(fullPath, discovered, depth + 1, budget);
        continue;
      }

      if (!entry.isFile || !/\.(tsx|jsx)$/i.test(entry.name)) continue;

      const ext = entry.name.substring(entry.name.lastIndexOf("."));
      const componentName = basename(entry.name, ext);
      if (componentName === "index") continue;
      if (!isValidComponentName(componentName)) continue;
      const existing = discovered.get(componentName);
      if (existing && existing.path !== fullPath) {
        throw COMPONENT_ERROR.create({
          detail: `Multiple components use the name ${componentName}`,
        });
      }
      if (!discovered.has(componentName) && discovered.size >= MAX_COMPONENTS) {
        throw new RangeError("Component discovery count limit exceeded");
      }

      discovered.set(componentName, {
        name: componentName,
        path: fullPath,
        isLoaded: false,
      });
    }
  }

  loadComponent(name: string): Promise<ComponentInfo | null> {
    return withSpan(
      "modules.componentRegistry.loadComponent",
      async () => {
        await this.initializedPromise;

        const existing = this.loadingComponents.get(name);
        if (existing) {
          const loaded = await existing;
          return loaded ? cloneComponentInfo(loaded) : null;
        }

        const promise = this.loadComponentInternal(name);
        this.loadingComponents.set(name, promise);
        try {
          const loaded = await promise;
          return loaded ? cloneComponentInfo(loaded) : null;
        } finally {
          if (this.loadingComponents.get(name) === promise) {
            this.loadingComponents.delete(name);
          }
        }
      },
      {},
    );
  }

  private async loadComponentInternal(name: string): Promise<ComponentInfo | null> {
    const component = this.components.get(name);
    if (!component) return null;
    if (component.isLoaded) return component;

    try {
      const stat = await this.adapter.fs.stat(component.path);
      if (!stat.isFile) {
        throw COMPONENT_ERROR.create({ detail: "Component path is not a file" });
      }
      if (stat.size < 0 || stat.size > MAX_COMPONENT_SOURCE_BYTES) {
        throw COMPONENT_ERROR.create({ detail: "Component source exceeds size limit" });
      }
      const content = await this.adapter.fs.readFile(component.path);
      if (new TextEncoder().encode(content).byteLength > MAX_COMPONENT_SOURCE_BYTES) {
        throw COMPONENT_ERROR.create({ detail: "Component source exceeds size limit" });
      }
      if (this.components.get(name) !== component) return null;

      component.content = content;
      component.isLoaded = true;
      return component;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT" || (error instanceof Error && error.name === "NotFound")) return null;
      logger.error("Failed to load component", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }
  }

  loadAll(): Promise<void> {
    return withSpan(
      "modules.componentRegistry.loadAll",
      async () => {
        const names = Array.from(this.components.keys());
        for (let offset = 0; offset < names.length; offset += LOAD_BATCH_SIZE) {
          await Promise.all(
            names.slice(offset, offset + LOAD_BATCH_SIZE).map((name) => this.loadComponent(name)),
          );
        }
      },
      { "registry.componentCount": this.components.size },
    );
  }

  get(name: string): ComponentInfo | undefined {
    const component = this.components.get(name);
    return component ? cloneComponentInfo(component) : undefined;
  }

  getAll(): Map<string, ComponentInfo> {
    return new Map(
      Array.from(this.components, ([name, info]) => [name, cloneComponentInfo(info)]),
    );
  }

  getLoader(): ComponentLoader {
    if (this.componentLoader) return this.componentLoader;

    const configuredProjectDir = normalize(this.options.projectDir);
    this.componentLoader = {
      loadComponent: async (componentName, source, projectDir) => {
        if (!isValidComponentName(componentName)) {
          throw INVALID_ARGUMENT.create({ detail: "Component name is invalid" });
        }
        if (normalize(projectDir) !== configuredProjectDir) {
          throw INVALID_ARGUMENT.create({
            detail: "Component project directory does not match the registry",
          });
        }
        const registeredPath = this.components.get(componentName)?.path;
        const filePath = registeredPath && !registeredPath.startsWith("virtual:")
          ? registeredPath
          : join(configuredProjectDir, `${componentName}.tsx`);
        return await loadComponentFromSource(
          source,
          filePath,
          configuredProjectDir,
          this.adapter,
          {
            projectId: this.options.projectId ?? this.options.projectDir,
            moduleServerUrl: this.options.moduleServerUrl,
            vendorBundleHash: this.options.vendorBundleHash,
            ssr: false,
          },
        );
      },
      clearCache: () =>
        clearSSRModuleCacheForProject(this.options.projectId ?? this.options.projectDir),
    };
    return this.componentLoader;
  }

  getAllAsComponents(): Record<string, React.ComponentType<unknown>> {
    const components: Record<string, React.ComponentType<unknown>> = {};

    for (const [name, info] of this.components) {
      const component = info.exports?.default;
      if (isReactComponent(component)) {
        components[name] = component as React.ComponentType<unknown>;
      }
    }

    return components;
  }

  has(name: string): boolean {
    return this.components.has(name);
  }

  add(name: string, info: Partial<ComponentInfo>): void {
    if (!isValidComponentName(name)) {
      throw INVALID_ARGUMENT.create({ detail: "Component name is invalid" });
    }
    if (!this.components.has(name) && this.components.size >= MAX_COMPONENTS) {
      throw SERVICE_OVERLOADED.create({ detail: "Component registry capacity exceeded" });
    }
    if (
      info.content !== undefined &&
      new TextEncoder().encode(info.content).byteLength > MAX_COMPONENT_SOURCE_BYTES
    ) {
      throw INVALID_ARGUMENT.create({ detail: "Component source exceeds size limit" });
    }
    const componentPath = info.path ?? `virtual:${name}`;
    if (
      componentPath.length === 0 || componentPath.length > MAX_COMPONENT_PATH_LENGTH ||
      hasUnsafeControlCharacters(componentPath)
    ) {
      throw INVALID_ARGUMENT.create({ detail: "Component path is invalid" });
    }
    this.components.set(name, {
      name,
      path: componentPath,
      content: info.content,
      isLoaded: true,
      exports: info.exports ? { ...info.exports } : undefined,
    });
  }

  remove(name: string): void {
    this.components.delete(name);
  }

  clear(): void {
    this.generation++;
    this.components.clear();
    this.loadingComponents.clear();
    this.initializedPromise = null;
  }

  getComponentNames(): string[] {
    return Array.from(this.components.keys());
  }

  async listComponents(): Promise<
    Array<{
      name: string;
      path: string;
      size?: number;
      lastModified?: string;
      type: string;
    }>
  > {
    const components: Array<{
      name: string;
      path: string;
      size?: number;
      lastModified?: string;
      type: string;
    }> = [];

    for (const [name, info] of this.components) {
      try {
        const stat = await this.adapter.fs.stat(info.path);
        components.push({
          name,
          path: info.path,
          size: stat.size,
          lastModified: stat.mtime?.toISOString(),
          type: "component",
        });
      } catch (_) {
        /* expected: stat may fail for components without filesystem entries */
        components.push({ name, path: info.path, type: "component" });
      }
    }

    return components;
  }
}
