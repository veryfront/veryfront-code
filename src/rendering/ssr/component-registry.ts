/**
 * Component registry for managing and loading React components.
 * @module
 */

import { dirname, join } from "../../platform/compat/path-helper.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import * as React from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { DEFAULT_DASHBOARD_PORT } from "@veryfront/utils";
import { VirtualModuleSystem } from "../virtual-module-system.ts";
import { loadComponentFromSource } from "@veryfront/modules/react-loader/component-loader.ts";

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

/**
 * Creates an error boundary component that renders a fallback for failed components.
 * This prevents one broken component from crashing the entire page.
 */
function createErrorFallbackComponent(
  componentName: string,
  error: string,
): React.ComponentType<Record<string, unknown>> {
  // Create a functional component that renders an error placeholder
  const ErrorFallback: React.FC<Record<string, unknown>> = () => {
    // In production, render nothing (or a minimal placeholder)
    // In development, show error details
    const isDev = typeof process !== "undefined" &&
      process.env?.NODE_ENV === "development";

    if (!isDev) {
      // Production: render an empty fragment to avoid breaking layout
      return React.createElement(React.Fragment);
    }

    // Development: show error details
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
  return ErrorFallback as React.ComponentType<Record<string, unknown>>;
}

/**
 * Registry for managing React components with virtual module system integration.
 * Supports deferred loading, caching, and component initialization.
 *
 * @example
 * ```ts
 * const registry = new ComponentRegistry(virtualModules, 3000, adapter)
 * await registry.loadFromDirectory('./components')
 * const Button = registry.get('Button')
 * ```
 */
export class ComponentRegistry {
  private components: Map<string, React.ComponentType<Record<string, unknown>>> = new Map();
  private virtualModules: VirtualModuleSystem;
  private componentSources: Map<string, DeferredComponentSource> = new Map();
  private failedComponents: Map<string, FailedComponent> = new Map();
  private initialized = false;
  private projectDir = "";
  private serverPort: number;
  private adapter?: RuntimeAdapter;
  private moduleServerUrl?: string;
  private vendorBundleHash?: string;

  /**
   * Creates a new component registry.
   *
   * @param virtualModules - Optional virtual module system instance
   * @param serverPort - Server port for module loading (defaults to DEFAULT_DASHBOARD_PORT)
   * @param adapter - Runtime adapter for file system operations
   * @param moduleServerUrl - Optional URL for module server
   * @param vendorBundleHash - Optional hash for vendor bundle versioning
   */
  constructor(
    virtualModules?: VirtualModuleSystem,
    serverPort: number = DEFAULT_DASHBOARD_PORT,
    adapter?: RuntimeAdapter,
    moduleServerUrl?: string,
    vendorBundleHash?: string,
  ) {
    this.virtualModules = virtualModules || new VirtualModuleSystem();
    this.serverPort = serverPort;
    this.adapter = adapter;
    this.moduleServerUrl = moduleServerUrl;
    this.vendorBundleHash = vendorBundleHash;
  }

  /**
   * Loads components from a directory.
   *
   * @param dir - Directory path containing component files
   * @param deferLoading - If true, stores component sources for later initialization
   *
   * @remarks
   * Processes files with extensions: .tsx, .jsx, .ts, .js
   * Automatically determines project root from directory structure
   * Registers components in virtual module system
   */
  async loadFromDirectory(dir: string, deferLoading = false): Promise<void> {
    const actualProjectRoot = dir.endsWith("/components") || dir.endsWith("\\components")
      ? dirname(dir)
      : dir;

    if (!this.projectDir) {
      this.projectDir = actualProjectRoot;
    }

    try {
      const processed = await this.collectComponents(dir, actualProjectRoot, deferLoading);
      logger.info(`Loaded ${processed} component${processed === 1 ? "" : "s"} from ${dir}`);
    } catch (error) {
      logger.debug(`Components directory not found: ${dir}`, error);
    }
  }

  /**
   * Retrieves a component by name.
   *
   * @param name - Component name (without file extension)
   * @returns The React component or null if not found
   *
   * @remarks
   * Returns null if component is pending initialization (deferred loading)
   */
  get(name: string): React.ComponentType<Record<string, unknown>> | null {
    const component = this.components.get(name);

    if (component) {
      return component;
    }

    if (this.componentSources.has(name) && !this.initialized) {
      logger.warn(`Component ${name} requested before initialization complete`);
      return null;
    }

    return null;
  }

  /**
   * Gets all registered components as a record.
   *
   * @returns Record mapping component names to component instances
   */
  getAll(): Record<string, React.ComponentType<Record<string, unknown>>> {
    const result: Record<string, React.ComponentType<Record<string, unknown>>> = {};
    for (const [name, component] of this.components) {
      result[name] = component;
    }
    return result;
  }

  /**
   * Gets all components as MDXComponents record (for MDX rendering).
   * Returns components typed as ComponentType<unknown> for compatibility with MDX.
   *
   * @returns Record mapping component names to component instances with unknown props
   */
  getAllAsComponents(): Record<string, React.ComponentType<unknown>> {
    const result: Record<string, React.ComponentType<unknown>> = {};
    for (const [name, component] of this.components) {
      result[name] = component as React.ComponentType<unknown>;
    }
    return result;
  }

  /**
   * Checks if a component is registered.
   *
   * @param name - Component name to check
   * @returns True if the component is registered
   */
  has(name: string): boolean {
    return this.components.has(name);
  }

  /**
   * Gets the virtual module system instance.
   *
   * @returns The virtual module system used by this registry
   */
  getVirtualModuleSystem(): VirtualModuleSystem {
    return this.virtualModules;
  }

  /**
   * Clear loaded components and reset initialization state.
   */
  clear(): void {
    this.components.clear();
    this.componentSources.clear();
    this.failedComponents.clear();
    this.initialized = false;
  }

  /**
   * Initializes all deferred components.
   * Should be called after loadFromDirectory with deferLoading=true.
   *
   * @remarks
   * Loads all stored component sources and marks registry as initialized.
   * Failed components are replaced with error fallback components to prevent
   * one broken component from crashing the entire page.
   * Only runs once - subsequent calls return immediately.
   */
  async initializeComponents(): Promise<void> {
    if (this.initialized) return;
    if (!this.adapter) {
      logger.warn("Component registry adapter unavailable; skipping initialization");
      return;
    }

    logger.info(`Initializing ${this.componentSources.size} deferred components`);

    let successCount = 0;
    let failCount = 0;

    for (const [componentName, info] of this.componentSources) {
      try {
        const Component = await loadComponentFromSource(
          info.source,
          info.filePath,
          info.projectRoot,
          this.adapter!,
          {
            projectId: info.projectRoot,
            dev: true,
            moduleServerUrl: this.moduleServerUrl,
            vendorBundleHash: this.vendorBundleHash,
          },
        );

        this.components.set(componentName, Component);
        // Clear any previous failure record
        this.failedComponents.delete(componentName);
        successCount++;
        logger.debug(`Successfully loaded component: ${componentName}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        failCount++;

        // Track the failure
        this.failedComponents.set(componentName, {
          name: componentName,
          error: errorMessage,
          filePath: info.filePath,
          timestamp: Date.now(),
        });

        // Create and register a fallback component
        const fallbackComponent = createErrorFallbackComponent(componentName, errorMessage);
        this.components.set(componentName, fallbackComponent);

        logger.error(`Failed to load component ${componentName}, using fallback:`, {
          error: errorMessage,
          filePath: info.filePath,
        });
      }
    }

    this.componentSources.clear();
    this.initialized = true;

    if (failCount > 0) {
      logger.warn(
        `Component initialization complete: ${successCount} succeeded, ${failCount} failed (using fallbacks)`,
      );
    } else {
      logger.info(`Component initialization complete: ${successCount} components loaded`);
    }
  }

  /**
   * Gets information about failed components.
   * @returns Array of failed component records
   */
  getFailedComponents(): FailedComponent[] {
    return Array.from(this.failedComponents.values());
  }

  /**
   * Checks if a component failed to load.
   * @param name - Component name to check
   * @returns True if the component failed to load
   */
  hasFailed(name: string): boolean {
    return this.failedComponents.has(name);
  }

  private async collectComponents(
    dir: string,
    projectRoot: string,
    deferLoading: boolean,
  ): Promise<number> {
    if (!this.adapter?.fs.readDir) {
      return 0;
    }

    let count = 0;

    for await (const entry of this.adapter.fs.readDir(dir)) {
      const entryPath = join(dir, entry.name);

      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }

      if (entry.isDirectory) {
        count += await this.collectComponents(entryPath, projectRoot, deferLoading);
        continue;
      }

      if (
        !(entry.isFile || entry.isSymlink) ||
        !/\.(tsx|jsx|ts|js)$/.test(entry.name)
      ) {
        continue;
      }

      const componentName = entry.name.replace(/\.(tsx|jsx|ts|js)$/, "");
      if (componentName === "index") {
        continue;
      }

      try {
        const fileContent = await this.adapter.fs.readFile(entryPath);

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
            this.adapter!,
            {
              projectId: projectRoot,
              dev: true,
              moduleServerUrl: this.moduleServerUrl,
              vendorBundleHash: this.vendorBundleHash,
            },
          );

          this.components.set(componentName, Component);
          logger.debug(`Loaded component immediately: ${componentName}`);
        }

        count++;
      } catch (error) {
        logger.error(`Failed to process component ${componentName} (${entryPath}):`, error);
      }
    }

    return count;
  }
}
