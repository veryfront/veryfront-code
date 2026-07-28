import { serverLogger as logger } from "#veryfront/utils";
import { basename, isAbsolute, join, normalize } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type * as React from "react";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

const MAX_COMPONENTS = 10_000;
const MAX_COMPONENT_DIRECTORY_DEPTH = 64;

function immutableComponentInfo(info: ComponentInfo): ComponentInfo {
  const exports = info.exports ? Object.freeze({ ...info.exports }) : undefined;
  return Object.freeze({
    ...info,
    ...(exports ? { exports } : {}),
  });
}

function normalizeComponentDirectory(directory: string): string {
  if (typeof directory !== "string" || directory.length === 0) {
    throw new TypeError("Component directories must be non-empty strings");
  }
  const normalized = normalize(directory).replace(/\\/g, "/");
  if (
    isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new TypeError(
      `Component directory must stay within the project root: ${directory}`,
    );
  }
  return normalized;
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
  private readonly componentDirs: readonly string[];
  private initializedPromise: Promise<void> | null = null;
  private readonly adapter: RuntimeAdapter;
  private readonly componentLoads = new Map<
    string,
    Promise<ComponentInfo | null>
  >();
  private generation = 0;

  constructor(private options: ComponentRegistryOptions) {
    this.adapter = options.adapter;
    this.componentDirs = Object.freeze(
      Array.from(
        new Set(
          (
            options.componentDirs ?? [
              "components",
              "islands",
              "src/components",
              "src/islands",
            ]
          ).map(normalizeComponentDirectory),
        ),
      ),
    );
  }

  discover(): Promise<void> {
    if (this.initializedPromise) return this.initializedPromise;

    const generation = this.generation;
    const discovery = withSpan(
      "modules.componentRegistry.discover",
      async () => {
        const discovered = await this._discoverInternal();
        if (this.generation === generation) {
          this.components = discovered;
        }
      },
      { "registry.projectDir": this.options.projectDir },
    );
    this.initializedPromise = discovery;
    const clearDiscovery = (): void => {
      if (this.initializedPromise === discovery) {
        this.initializedPromise = null;
      }
    };
    void discovery.then(clearDiscovery, clearDiscovery);
    return discovery;
  }

  private async _discoverInternal(): Promise<Map<string, ComponentInfo>> {
    logger.debug(`Discovering components in: ${this.componentDirs.join(", ")}`);
    const discovered = new Map<string, ComponentInfo>();

    for (const dir of this.componentDirs) {
      const fullPath = join(this.options.projectDir, dir);

      try {
        await this.walkDirectory(fullPath, discovered, 0);
      } catch (error) {
        if (isNotFoundError(error)) continue;
        throw error;
      }
    }

    logger.debug(`Discovered ${discovered.size} components`);
    return discovered;
  }

  private async walkDirectory(
    dir: string,
    discovered: Map<string, ComponentInfo>,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_COMPONENT_DIRECTORY_DEPTH) {
      throw new RangeError(
        `Component directory depth exceeds ${MAX_COMPONENT_DIRECTORY_DEPTH}: ${dir}`,
      );
    }

    const entries = await Array.fromAsync(this.adapter.fs.readDir(dir));
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name.includes(".test.") ||
        entry.name.includes(".spec.")
      ) {
        continue;
      }

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        await this.walkDirectory(fullPath, discovered, depth + 1);
        continue;
      }

      if (!entry.isFile || !/\.(tsx|jsx)$/.test(entry.name)) continue;

      const ext = entry.name.substring(entry.name.lastIndexOf("."));
      const componentName = basename(entry.name, ext);
      if (componentName === "index") continue;

      const existing = discovered.get(componentName);
      if (existing) {
        throw new TypeError(
          `Duplicate component name "${componentName}" resolves to both ${existing.path} and ${fullPath}`,
        );
      }
      if (discovered.size >= MAX_COMPONENTS) {
        throw new RangeError(
          `Component registry exceeds the ${MAX_COMPONENTS} component limit`,
        );
      }

      discovered.set(
        componentName,
        immutableComponentInfo({
          name: componentName,
          path: fullPath,
          isLoaded: false,
        }),
      );

      logger.debug(`Discovered component: ${componentName} at ${fullPath}`);
    }
  }

  loadComponent(name: string): Promise<ComponentInfo | null> {
    return withSpan(
      "modules.componentRegistry.loadComponent",
      async () => {
        await this.initializedPromise;

        const component = this.components.get(name);
        if (!component) {
          logger.warn(`Component not found: ${name}`);
          return null;
        }

        if (component.isLoaded) return component;

        const existingLoad = this.componentLoads.get(name);
        if (existingLoad) return await existingLoad;

        const load = (async (): Promise<ComponentInfo | null> => {
          try {
            const loaded = immutableComponentInfo({
              ...component,
              content: await this.adapter.fs.readFile(component.path),
              isLoaded: true,
            });
            if (this.components.get(name) === component) {
              this.components.set(name, loaded);
            }
            logger.debug(`Loaded component: ${name}`);
            return loaded;
          } catch (error) {
            if (isNotFoundError(error)) return null;
            logger.error(`Failed to load component ${name}:`, error);
            throw error;
          }
        })();
        this.componentLoads.set(name, load);
        try {
          return await load;
        } finally {
          if (this.componentLoads.get(name) === load) {
            this.componentLoads.delete(name);
          }
        }
      },
      { "registry.componentName": name },
    );
  }

  loadAll(): Promise<void> {
    return withSpan(
      "modules.componentRegistry.loadAll",
      async () => {
        await Promise.all(Array.from(this.components.keys(), (name) => this.loadComponent(name)));
      },
      { "registry.componentCount": this.components.size },
    );
  }

  get(name: string): ComponentInfo | undefined {
    return this.components.get(name);
  }

  getAll(): Map<string, ComponentInfo> {
    return new Map(this.components);
  }

  getLoader(): ComponentLoader | undefined {
    return undefined;
  }

  getAllAsComponents(): Record<string, React.ComponentType<unknown>> {
    const components: Record<string, React.ComponentType<unknown>> = {};

    for (const [name, info] of this.components) {
      const component = info.exports?.default;
      if (component) components[name] = component as React.ComponentType<unknown>;
    }

    return components;
  }

  has(name: string): boolean {
    return this.components.has(name);
  }

  add(name: string, info: Partial<ComponentInfo>): void {
    this.components.set(
      name,
      immutableComponentInfo({
        name,
        path: info.path ?? `virtual:${name}`,
        content: info.content,
        isLoaded: true,
        exports: info.exports,
      }),
    );
  }

  remove(name: string): void {
    this.components.delete(name);
  }

  clear(): void {
    this.generation += 1;
    this.components.clear();
    this.initializedPromise = null;
    this.componentLoads.clear();
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
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        components.push({ name, path: info.path, type: "component" });
      }
    }

    return components;
  }
}
