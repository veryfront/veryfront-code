import { serverLogger as logger } from "#veryfront/utils";
import { basename, join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type * as React from "react";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

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
  private componentDirs: string[];
  private initializedPromise: Promise<void> | null = null;
  private adapter: RuntimeAdapter;
  private initialized = false;

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
    return withSpan(
      "modules.componentRegistry.discover",
      async () => {
        this.initialized = false;
        this.initializedPromise = this._discoverInternal().then(() => {
          this.initialized = true;
        });
        await this.initializedPromise;
      },
      { "registry.projectDir": this.options.projectDir },
    );
  }

  private async _discoverInternal(): Promise<void> {
    logger.debug(`Discovering components in: ${this.componentDirs.join(", ")}`);

    for (const dir of this.componentDirs) {
      const fullPath = join(this.options.projectDir, dir);

      try {
        await this.walkDirectory(fullPath);
      } catch (error) {
        // Silently skip missing directories - they're optional
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        const isNotFound = code === "ENOENT" ||
          (error instanceof Error && error.name === "NotFound");
        if (isNotFound) continue;

        logger.warn(`Failed to discover components in ${fullPath}:`, error);
      }
    }

    logger.debug(`Discovered ${this.components.size} components`);
  }

  private async walkDirectory(dir: string): Promise<void> {
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
        await this.walkDirectory(fullPath);
        continue;
      }

      if (!entry.isFile || !/\.(tsx|jsx)$/.test(entry.name)) continue;

      const ext = entry.name.substring(entry.name.lastIndexOf("."));
      const componentName = basename(entry.name, ext);
      if (componentName === "index") continue;

      this.components.set(componentName, {
        name: componentName,
        path: fullPath,
        isLoaded: false,
      });

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
          component.content = await this.adapter.fs.readFile(component.path);
          component.isLoaded = true;
          logger.debug(`Loaded component: ${name}`);
          return component;
        } catch (error) {
          logger.error(`Failed to load component ${name}:`, error);
          return null;
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

  /**
   * Loader accessor for compatibility with older tests; loader is not used in this registry.
   */
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
    this.components.set(name, {
      name,
      path: info.path ?? `virtual:${name}`,
      content: info.content,
      isLoaded: true,
      exports: info.exports,
    });
  }

  remove(name: string): void {
    this.components.delete(name);
  }

  clear(): void {
    this.components.clear();
    this.initialized = false;
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
      } catch {
        components.push({ name, path: info.path, type: "component" });
      }
    }

    return components;
  }
}
