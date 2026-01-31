import { dirname, join } from "../../platform/compat/path-helper.ts";
import { DEFAULT_DASHBOARD_PORT, rendererLogger as logger } from "#veryfront/utils";
import * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { VirtualModuleSystem } from "../virtual-module-system.ts";
import { loadComponentFromSource } from "#veryfront/modules/react-loader/component-loader.ts";

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

function createErrorFallbackComponent(
  componentName: string,
  error: string,
): React.ComponentType<Record<string, unknown>> {
  const ErrorFallback: React.FC<Record<string, unknown>> = () => {
    const isDev = typeof process !== "undefined" && process.env?.NODE_ENV === "development";
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

  constructor(
    virtualModules?: VirtualModuleSystem,
    serverPort: number = DEFAULT_DASHBOARD_PORT,
    adapter?: RuntimeAdapter,
    moduleServerUrl?: string,
    vendorBundleHash?: string,
    projectId?: string,
    contentSourceId?: string,
  ) {
    this.virtualModules = virtualModules ?? new VirtualModuleSystem();
    this.serverPort = serverPort;
    this.adapter = adapter;
    this.moduleServerUrl = moduleServerUrl;
    this.vendorBundleHash = vendorBundleHash;
    this.projectId = projectId;
    this.contentSourceId = contentSourceId;
  }

  async loadFromDirectory(dir: string, deferLoading = false): Promise<void> {
    const actualProjectRoot = dir.endsWith("/components") || dir.endsWith("\\components")
      ? dirname(dir)
      : dir;

    this.projectDir ||= actualProjectRoot;

    try {
      const processed = await this.collectComponents(dir, actualProjectRoot, deferLoading);
      logger.debug(`Loaded ${processed} component${processed === 1 ? "" : "s"} from ${dir}`);
    } catch (error) {
      logger.debug(`Components directory not found: ${dir}`, error);
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
    this.failedComponents.clear();
    this.initialized = false;
  }

  async initializeComponents(): Promise<void> {
    if (this.initialized) return;

    const adapter = this.adapter;
    if (!adapter) {
      logger.warn("Component registry adapter unavailable; skipping initialization");
      return;
    }

    logger.debug(`Initializing ${this.componentSources.size} deferred components`);

    let successCount = 0;
    let failCount = 0;

    for (const [componentName, info] of this.componentSources) {
      try {
        const Component = await loadComponentFromSource(
          info.source,
          info.filePath,
          info.projectRoot,
          adapter,
          this.getLoaderOptions(info.projectRoot),
        );

        this.components.set(componentName, Component);
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

        this.components.set(
          componentName,
          createErrorFallbackComponent(componentName, errorMessage),
        );

        logger.debug(`Failed to load component ${componentName}, using fallback`, {
          error: errorMessage,
          filePath: info.filePath,
        });
      }
    }

    this.componentSources.clear();
    this.initialized = true;

    if (failCount > 0) {
      logger.warn(
        `Component initialization complete: ${successCount} succeeded, ${failCount} failed (using fallbacks, set LOG_LEVEL=debug for details)`,
      );
      return;
    }

    logger.debug(`Component initialization complete: ${successCount} components loaded`);
  }

  getFailedComponents(): FailedComponent[] {
    return Array.from(this.failedComponents.values());
  }

  hasFailed(name: string): boolean {
    return this.failedComponents.has(name);
  }

  private getLoaderOptions(projectRoot: string): {
    projectId: string;
    dev: true;
    moduleServerUrl?: string;
    vendorBundleHash?: string;
    contentSourceId?: string;
  } {
    return {
      projectId: this.projectId ?? projectRoot,
      dev: true,
      moduleServerUrl: this.moduleServerUrl,
      vendorBundleHash: this.vendorBundleHash,
      contentSourceId: this.contentSourceId,
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

      const componentName = entry.name.replace(/\.(tsx|jsx|ts|js)$/, "");
      if (componentName === "index") continue;

      try {
        const fileContent = await adapter.fs.readFile(entryPath);

        await this.virtualModules.registerModule(`component:${componentName}`, fileContent, dir);

        if (deferLoading) {
          this.componentSources.set(componentName, {
            source: fileContent,
            filePath: entryPath,
            projectRoot,
          });
          logger.debug(`Stored component source for deferred loading: ${componentName}`);
        } else {
          const Component = await loadComponentFromSource(
            fileContent,
            entryPath,
            projectRoot,
            adapter,
            this.getLoaderOptions(projectRoot),
          );

          this.components.set(componentName, Component);
          logger.debug(`Loaded component immediately: ${componentName}`);
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
