import { serverLogger as logger } from "@veryfront/utils";
import { basename, join } from "std/path/mod.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

/** Component module exports structure */
export interface ComponentExports {
  default?: unknown;
  [key: string]: unknown;
}

/** Metadata and state for a discovered component */
export interface ComponentInfo {
  name: string;
  path: string;
  content?: string;
  isLoaded: boolean;
  exports?: ComponentExports;
}

/** Configuration options for ComponentRegistry */
export interface ComponentRegistryOptions {
  projectDir: string;
  componentDirs?: string[];
  adapter: RuntimeAdapter;
  moduleServerUrl?: string;
  vendorBundleHash?: string;
}

/** Interface for component loading callbacks */
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
    this.componentDirs = options.componentDirs || [
      "components",
      "islands",
      "src/components",
      "src/islands",
    ];
  }

  async discover(): Promise<void> {
    this.initialized = false;
    this.initializedPromise = (async () => {
      await this._discoverInternal();
      this.initialized = true;
    })();
    await this.initializedPromise;
  }

  private async _discoverInternal(): Promise<void> {
    logger.debug(`Discovering components in: ${this.componentDirs.join(", ")}`);

    for (const dir of this.componentDirs) {
      const fullPath = join(this.options.projectDir, dir);

      try {
        await this.walkDirectory(fullPath);
      } catch (error) {
        const isNotFound = (error as NodeJS.ErrnoException)?.code === "ENOENT" ||
          (error instanceof Error && error.name === "NotFound");
        if (!isNotFound) {
          logger.warn(`Failed to discover components in ${fullPath}:`, error);
        }
      }
    }

    logger.debug(`Discovered ${this.components.size} components`);
  }

  private async walkDirectory(dir: string): Promise<void> {
    const entries = this.adapter.fs.readDir(dir);

    for await (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (
        entry.name === "node_modules" ||
        entry.name.includes(".test.") ||
        entry.name.includes(".spec.")
      ) {
        continue;
      }

      if (entry.isDirectory) {
        await this.walkDirectory(fullPath);
      } else if (entry.isFile && /\.(tsx|jsx)$/.test(entry.name)) {
        const componentName = basename(
          entry.name,
          entry.name.substring(entry.name.lastIndexOf(".")),
        );

        if (componentName === "index") continue;

        const component: ComponentInfo = {
          name: componentName,
          path: fullPath,
          isLoaded: false,
        };

        this.components.set(componentName, component);
        logger.debug(`Discovered component: ${componentName} at ${fullPath}`);
      }
    }
  }

  async loadComponent(name: string): Promise<ComponentInfo | null> {
    if (this.initializedPromise) {
      await this.initializedPromise;
    }
    const component = this.components.get(name);
    if (!component) {
      logger.warn(`Component not found: ${name}`);
      return null;
    }

    if (component.isLoaded) {
      return component;
    }

    try {
      component.content = await this.adapter.fs.readFile(component.path);
      component.isLoaded = true;

      logger.debug(`Loaded component: ${name}`);
      return component;
    } catch (error) {
      logger.error(`Failed to load component ${name}:`, error);
      return null;
    }
  }

  async loadAll(): Promise<void> {
    const loadPromises = Array.from(this.components.keys()).map((name) => this.loadComponent(name));

    await Promise.all(loadPromises);
  }

  get(name: string): ComponentInfo | undefined {
    return this.components.get(name);
  }

  getAll(): Map<string, ComponentInfo> {
    return new Map(this.components);
  }

  /**
   * Get all components that have been loaded and have a default export.
   * Returns a record mapping component names to their default exports.
   */
  getAllAsComponents(): Record<string, unknown> {
    const components: Record<string, unknown> = {};
    for (const [name, info] of this.components.entries()) {
      if (info.exports?.default) {
        components[name] = info.exports.default;
      }
    }
    return components;
  }

  has(name: string): boolean {
    return this.components.has(name);
  }

  add(name: string, info: Partial<ComponentInfo>): void {
    this.components.set(name, {
      name,
      path: info.path || `virtual:${name}`,
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
    const components = [];

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
        components.push({
          name,
          path: info.path,
          type: "component",
        });
      }
    }

    return components;
  }
}
