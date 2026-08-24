import { serverLogger as logger } from "#veryfront/utils";
import { basename, join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type * as React from "react";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ALREADY_EXISTS } from "#veryfront/errors/error-registry/general.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";

export interface ComponentExports {
  default?: unknown;
  [key: string]: unknown;
}

export interface ComponentInfo {
  readonly name: string;
  readonly path: string;
  readonly content?: string;
  readonly isLoaded: boolean;
  readonly exports?: ComponentExports;
}

function immutableComponentInfo(info: ComponentInfo): ComponentInfo {
  return Object.freeze(info);
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
  private manualComponents = new Set<string>();
  private componentDirs: string[];
  private initializedPromise: Promise<void> | null = null;
  private discoveryInFlight: Promise<void> | null = null;
  // Bumped by clear() so async work started before it discards its result.
  private lifecycleGeneration = 0;
  private adapter: RuntimeAdapter;

  constructor(private options: ComponentRegistryOptions) {
    this.adapter = options.adapter;
    this.componentDirs = options.componentDirs ?? [
      "components",
      "islands",
      "src/components",
      "src/islands",
    ];
  }

  discover(): Promise<void> {
    if (this.discoveryInFlight) return this.discoveryInFlight;

    const generation = this.lifecycleGeneration;
    const discovery = withSpan(
      "modules.componentRegistry.discover",
      async () => {
        const discovered = await this._discoverInternal();
        if (generation !== this.lifecycleGeneration) return;
        const nextComponents = new Map<string, ComponentInfo>();

        for (const name of this.manualComponents) {
          const component = this.components.get(name);
          if (component) nextComponents.set(name, component);
        }
        for (const [name, component] of discovered) {
          if (this.manualComponents.has(name)) continue;
          nextComponents.set(name, component);
        }

        this.components = nextComponents;
      },
      { "registry.projectDir": this.options.projectDir },
    );
    const trackedDiscovery = discovery.finally(() => {
      if (this.discoveryInFlight === trackedDiscovery) this.discoveryInFlight = null;
    });
    this.discoveryInFlight = trackedDiscovery;
    this.initializedPromise = trackedDiscovery;
    return trackedDiscovery;
  }

  private async _discoverInternal(): Promise<Map<string, ComponentInfo>> {
    logger.debug(`Discovering components in: ${this.componentDirs.join(", ")}`);
    const discovered = new Map<string, ComponentInfo>();

    for (const dir of this.componentDirs) {
      const fullPath = join(this.options.projectDir, dir);

      try {
        await this.walkDirectory(fullPath, discovered);
      } catch (error) {
        if (isCanonicalNotFoundError(error)) continue;
        throw error;
      }
    }

    logger.debug(`Discovered ${discovered.size} components`);
    return discovered;
  }

  private async walkDirectory(
    dir: string,
    discovered: Map<string, ComponentInfo>,
  ): Promise<void> {
    const entries = this.adapter.fs.readDir(dir);

    for await (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name.includes(".test.") ||
        entry.name.includes(".spec.")
      ) {
        continue;
      }

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        await this.walkDirectory(fullPath, discovered);
        continue;
      }

      if (!entry.isFile || !/\.(tsx|jsx)$/.test(entry.name)) continue;

      const ext = entry.name.substring(entry.name.lastIndexOf("."));
      const componentName = basename(entry.name, ext);
      if (componentName === "index") continue;

      const existing = discovered.get(componentName);
      if (existing && existing.path !== fullPath) {
        throw ALREADY_EXISTS.create({
          detail: `Component name '${componentName}' is already registered`,
          context: { componentName },
        });
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

        try {
          const content = await this.adapter.fs.readFile(component.path);
          if (this.components.get(name) !== component) {
            // The entry changed while the source was being read; load the
            // current entry instead of storing stale metadata.
            return this.loadComponent(name);
          }
          const loaded = immutableComponentInfo({
            ...component,
            content,
            isLoaded: true,
          });
          this.components.set(name, loaded);
          logger.debug(`Loaded component: ${name}`);
          return loaded;
        } catch (error) {
          if (this.components.get(name) !== component) {
            // The failed read belonged to a stale entry. A replacement may
            // already be loadable even though the old source disappeared.
            return this.loadComponent(name);
          }
          if (isCanonicalNotFoundError(error)) return null;
          throw error;
        }
      },
      { "registry.componentName": name },
    );
  }

  loadAll(): Promise<void> {
    return withSpan(
      "modules.componentRegistry.loadAll",
      async () => {
        await this.initializedPromise;
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
    this.manualComponents.add(name);
    this.components.set(
      name,
      immutableComponentInfo({
        name,
        path: info.path ?? `virtual:${name}`,
        content: info.content,
        isLoaded: info.isLoaded ?? (info.content !== undefined || info.exports !== undefined),
        exports: info.exports,
      }),
    );
  }

  remove(name: string): void {
    this.manualComponents.delete(name);
    this.components.delete(name);
  }

  clear(): void {
    this.lifecycleGeneration++;
    this.components.clear();
    this.manualComponents.clear();
    this.initializedPromise = null;
    this.discoveryInFlight = null;
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
