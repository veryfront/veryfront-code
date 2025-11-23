/**
 * Client-side hydration for Veryfront's minimal RSC implementation
 *
 * This handles:
 * - Finding RSC placeholders in the DOM
 * - Loading client components dynamically
 * - Hydrating placeholders with React components
 */

import * as React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { rscLogger } from "../client/browser-logger.ts";
import { CompilationError, FileSystemError, NetworkError } from "@veryfront/errors/index.ts";
import type { RSCHydratorOptions } from "./types.ts";

export class RSCHydrator {
  private componentCache: Map<string, React.ComponentType<any>> = new Map();
  private manifestUrl: string;
  private manifest: Record<string, string> | null = null;
  private onError?: (error: Error) => void;

  constructor(options: RSCHydratorOptions = {}) {
    this.manifestUrl = options.manifestUrl || "/_veryfront/rsc/manifest";
    this.onError = options.onError;
  }

  /**
   * Hydrate all RSC placeholders in the document
   */
  async hydrate(): Promise<void> {
    try {
      // Load manifest first
      await this.loadManifest();

      // Find all RSC placeholders
      const placeholders = document.querySelectorAll("[data-rsc-component]");

      rscLogger.info(`Found ${placeholders.length} components to hydrate`);

      // Hydrate each placeholder
      const hydrationPromises: Promise<void>[] = [];

      for (const placeholder of placeholders) {
        hydrationPromises.push(this.hydratePlaceholder(placeholder as HTMLElement));
      }

      // Wait for all hydrations to complete
      await Promise.all(hydrationPromises);

      rscLogger.info("Hydration complete");
    } catch (error) {
      rscLogger.error("Hydration error:", error);
      this.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Hydrate a single placeholder element
   */
  private async hydratePlaceholder(element: HTMLElement): Promise<void> {
    const componentName = element.dataset.rscComponent;
    const propsJson = element.dataset.rscProps;
    const instanceId = element.dataset.rscId;

    if (!componentName) {
      rscLogger.warn("Placeholder missing component name", element);
      return;
    }

    try {
      // Parse props
      const props = propsJson ? JSON.parse(propsJson) : {};

      // Load the client component
      const Component = await this.loadClientComponent(componentName);

      // Create React element
      const reactElement = React.createElement(Component, props);

      // Check if element has children (for hydration)
      if (element.innerHTML.trim()) {
        // Hydrate existing content - hydrateRoot accepts Element, not just HTMLElement
        rscLogger.debug(`Hydrating ${componentName} #${instanceId}`);
        hydrateRoot(element, reactElement);
      } else {
        // Render into empty container
        rscLogger.debug(`Rendering ${componentName} #${instanceId}`);
        const root = createRoot(element);
        root.render(reactElement);
      }
    } catch (error) {
      rscLogger.error(`Failed to hydrate component ${componentName}:`, error);
      this.onError?.(error as Error);

      // Show error in development
      if (this.isDevelopment()) {
        element.innerHTML = `
          <div style="color: red; border: 2px solid red; padding: 10px; margin: 5px;">
            <strong>RSC Hydration Error</strong><br>
            Component: ${componentName}<br>
            Error: ${(error as Error).message}
          </div>
        `;
      }
    }
  }

  /**
   * Load a client component module
   */
  private async loadClientComponent(name: string): Promise<React.ComponentType<any>> {
    // Check cache first
    if (this.componentCache.has(name)) {
      return this.componentCache.get(name)!;
    }

    // Get component path from manifest
    const componentPath = await this.getComponentPath(name);

    if (!componentPath) {
      throw new FileSystemError(`Client component not found in manifest`, {
        name,
        manifest: this.manifest,
      });
    }

    try {
      // Dynamic import
      rscLogger.debug(`Loading component ${name} from ${componentPath}`);
      const module = await import(componentPath);

      // Get the component (support both default and named exports)
      const Component = module.default || module[name];

      if (!Component) {
        throw new CompilationError(`Component ${name} not found in module`, {
          componentPath,
          name,
        });
      }

      // Validate it's a valid React component
      if (typeof Component !== "function" && typeof Component !== "object") {
        throw new CompilationError(`Invalid component type for ${name}`, {
          type: typeof Component,
          name,
        });
      }

      // Cache for future use
      this.componentCache.set(name, Component);

      return Component;
    } catch (error) {
      rscLogger.error(`Failed to load component ${name}:`, error);
      if (error instanceof CompilationError || error instanceof FileSystemError) {
        throw error;
      }
      throw new CompilationError(`Failed to load client component ${name}`, { cause: error, name });
    }
  }

  /**
   * Get component path from manifest
   */
  private async getComponentPath(name: string): Promise<string | null> {
    if (!this.manifest) {
      await this.loadManifest();
    }

    return this.manifest?.[name] || null;
  }

  /**
   * Load the client component manifest
   */
  private async loadManifest(): Promise<void> {
    if (this.manifest) return;

    try {
      const response = await fetch(this.manifestUrl);

      if (!response.ok) {
        throw new NetworkError(`Failed to load manifest`, {
          status: response.status,
          url: this.manifestUrl,
        });
      }

      const data = await response.json();

      // The manifest should be a map of component names to paths
      this.manifest = data.components || data;

      rscLogger.debug("Loaded manifest:", this.manifest);
    } catch (error) {
      rscLogger.error("Failed to load manifest:", error);

      // In development, try to continue without manifest
      if (this.isDevelopment()) {
        rscLogger.warn("Continuing without manifest - will try direct imports");
        this.manifest = {};
      } else {
        throw error;
      }
    }
  }

  /**
   * Check if running in development mode
   */
  private isDevelopment(): boolean {
    // Type-safe access to window globals
    interface WindowWithVeryfront extends Window {
      __VERYFRONT_DEV__?: boolean;
    }
    return !!(window as WindowWithVeryfront).__VERYFRONT_DEV__;
  }
}

/**
 * Global hydration function for easy use
 */
export function hydrateRSC(options?: RSCHydratorOptions): Promise<void> {
  const hydrator = new RSCHydrator(options);
  return hydrator.hydrate();
}

/**
 * Auto-hydrate on DOMContentLoaded if enabled
 */
if (typeof window !== "undefined") {
  // Type-safe access to window globals for auto-hydrate flag
  interface WindowWithAutoHydrate extends Window {
    __RSC_AUTO_HYDRATE__?: boolean;
  }
  const shouldAutoHydrate = (window as WindowWithAutoHydrate).__RSC_AUTO_HYDRATE__ !== false;

  if (shouldAutoHydrate) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        hydrateRSC().catch((error) => {
          rscLogger.error("Auto-hydration failed:", error);
        });
      });
    } else {
      // DOM already loaded
      hydrateRSC().catch((error) => {
        rscLogger.error("Auto-hydration failed:", error);
      });
    }
  }
}
