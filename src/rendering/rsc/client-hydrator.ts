import * as React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { rscLogger } from "../client/browser-logger.ts";
import { CompilationError, FileSystemError, NetworkError } from "#veryfront/errors/index.ts";
import { createErrorDisplay } from "#veryfront/security/client/html-sanitizer.ts";
import type { RSCHydratorOptions } from "./types.ts";

interface WindowWithVeryfront extends Window {
  __VERYFRONT_DEV__?: boolean;
  __RSC_AUTO_HYDRATE__?: boolean;
}

export class RSCHydrator {
  private componentCache = new Map<string, React.ComponentType<any>>();
  private manifestUrl: string;
  private manifest: Record<string, string> | null = null;
  private onError?: (error: Error) => void;

  constructor(options: RSCHydratorOptions = {}) {
    this.manifestUrl = options.manifestUrl ?? "/_veryfront/rsc/manifest";
    this.onError = options.onError;
  }

  async hydrate(): Promise<void> {
    try {
      await this.loadManifest();

      const placeholders = document.querySelectorAll("[data-rsc-component]");
      rscLogger.info(`Found ${placeholders.length} components to hydrate`);

      await Promise.all(
        Array.from(
          placeholders,
          (placeholder) => this.hydratePlaceholder(placeholder as HTMLElement),
        ),
      );

      rscLogger.info("Hydration complete");
    } catch (error) {
      rscLogger.error("Hydration error:", error);
      this.onError?.(error as Error);
      throw error;
    }
  }

  private async hydratePlaceholder(element: HTMLElement): Promise<void> {
    const componentName = element.dataset.rscComponent;
    const propsJson = element.dataset.rscProps;
    const instanceId = element.dataset.rscId;

    if (!componentName) {
      rscLogger.warn("Placeholder missing component name", element);
      return;
    }

    try {
      const props = propsJson ? JSON.parse(propsJson) : {};
      const Component = await this.loadClientComponent(componentName);
      const reactElement = React.createElement(Component, props);

      if (element.innerHTML.trim()) {
        rscLogger.debug(`Hydrating ${componentName} #${instanceId}`);
        hydrateRoot(element, reactElement, {
          identifierPrefix: "vf",
          onRecoverableError: () => {},
        });
        return;
      }

      rscLogger.debug(`Rendering ${componentName} #${instanceId}`);
      createRoot(element).render(reactElement);
    } catch (error) {
      rscLogger.error(`Failed to hydrate component ${componentName}:`, error);
      this.onError?.(error as Error);

      if (!this.isDevelopment()) return;

      element.textContent = "";
      element.appendChild(
        createErrorDisplay({
          title: "RSC Hydration Error",
          message: `Component: ${componentName}`,
          details: (error as Error).message,
        }),
      );
    }
  }

  private async loadClientComponent(name: string): Promise<React.ComponentType<any>> {
    const cached = this.componentCache.get(name);
    if (cached) return cached;

    const componentPath = await this.getComponentPath(name);
    if (!componentPath) {
      throw new FileSystemError(`Client component not found in manifest`, {
        name,
        manifest: this.manifest,
      });
    }

    try {
      rscLogger.debug(`Loading component ${name} from ${componentPath}`);
      const module = await import(componentPath);
      const Component = module.default || module[name];

      if (!Component) {
        throw new CompilationError(`Component ${name} not found in module`, {
          componentPath,
          name,
        });
      }

      if (typeof Component !== "function" && typeof Component !== "object") {
        throw new CompilationError(`Invalid component type for ${name}`, {
          type: typeof Component,
          name,
        });
      }

      this.componentCache.set(name, Component);
      return Component;
    } catch (error) {
      rscLogger.error(`Failed to load component ${name}:`, error);
      if (error instanceof CompilationError || error instanceof FileSystemError) throw error;
      throw new CompilationError(`Failed to load client component ${name}`, { cause: error, name });
    }
  }

  private async getComponentPath(name: string): Promise<string | null> {
    if (!this.manifest) await this.loadManifest();
    return this.manifest?.[name] ?? null;
  }

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
      this.manifest = data.components || data;

      rscLogger.debug("Loaded manifest:", this.manifest);
    } catch (error) {
      rscLogger.error("Failed to load manifest:", error);

      if (!this.isDevelopment()) throw error;

      rscLogger.warn("Continuing without manifest - will try direct imports");
      this.manifest = {};
    }
  }

  private isDevelopment(): boolean {
    return !!(window as WindowWithVeryfront).__VERYFRONT_DEV__;
  }
}

export function hydrateRSC(options?: RSCHydratorOptions): Promise<void> {
  return new RSCHydrator(options).hydrate();
}

function autoHydrate(): void {
  const shouldAutoHydrate = (window as WindowWithVeryfront).__RSC_AUTO_HYDRATE__ !== false;
  if (!shouldAutoHydrate) return;

  const run = (): void => {
    hydrateRSC().catch((error) => {
      rscLogger.error("Auto-hydration failed:", error);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
    return;
  }

  run();
}

if (typeof window !== "undefined") {
  autoHydrate();
}
