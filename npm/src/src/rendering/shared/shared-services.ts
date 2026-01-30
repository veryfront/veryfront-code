/**
 * Shared Renderer Services
 *
 * Provides singleton services that can be safely shared across all projects.
 * These services are either stateless (pure functions) or use content-addressed
 * caching that doesn't require tenant isolation.
 *
 * Services that hold project-specific state are NOT included here - they must
 * be created per-request using the service factories in ../factories/.
 *
 * @module rendering/shared/shared-services
 */

import { rendererLogger as logger } from "../../utils/index.js";
import { initializeTransform, isUsingEsbuild } from "../../platform/compat/transform.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../observability/tracing/span-names.js";
import { ElementValidator, type ValidationOptions } from "../element-validator/index.js";
import { type CompileMDXFunction, CompilerService } from "../orchestrator/compiler-service.js";

export interface SharedServicesOptions {
  debugMode?: boolean;
  maxValidationDepth?: number;
}

export interface SharedServices {
  elementValidator: ElementValidator;
  compilerService: CompilerService;
}

let sharedServices: SharedServices | null = null;
let initializationPromise: Promise<SharedServices> | null = null;

export async function initializeSharedServices(
  options: SharedServicesOptions = {},
): Promise<SharedServices> {
  if (sharedServices) return sharedServices;
  if (initializationPromise) return initializationPromise;

  const debugMode = options.debugMode ?? false;
  const maxValidationDepth = options.maxValidationDepth ?? 20;

  initializationPromise = withSpan(
    SpanNames.SHARED_SERVICES_INIT,
    async () => {
      logger.debug("[SharedServices] Initializing shared renderer services");
      const startTime = performance.now();

      // Initialize JSX transform (esbuild in dev, sucrase in deno compile)
      await initializeTransform();
      logger.debug("[SharedServices] Transform initialized", {
        backend: isUsingEsbuild() ? "esbuild" : "sucrase",
      });

      const validatorOptions: ValidationOptions = {
        maxDepth: maxValidationDepth,
        debugMode,
      };

      sharedServices = {
        elementValidator: new ElementValidator(validatorOptions),
        compilerService: new CompilerService(),
      };

      const duration = performance.now() - startTime;
      logger.debug("[SharedServices] Shared services initialized", {
        duration: `${duration.toFixed(2)}ms`,
      });

      return sharedServices;
    },
    {
      "shared_services.debug_mode": debugMode,
      "shared_services.max_validation_depth": maxValidationDepth,
    },
  );

  try {
    return await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

export function getSharedServices(): SharedServices {
  if (!sharedServices) {
    throw new Error("SharedServices not initialized. Call initializeSharedServices() first.");
  }
  return sharedServices;
}

export function areSharedServicesInitialized(): boolean {
  return sharedServices !== null;
}

export function setSharedCompileMDX(compileMDX: CompileMDXFunction): void {
  getSharedServices().compilerService.setCompileMDX(compileMDX);
}

export function getSharedCompileMDX(): CompileMDXFunction {
  return getSharedServices().compilerService.getCompileFunction();
}

export function destroySharedServices(): void {
  sharedServices = null;
  initializationPromise = null;
  logger.debug("[SharedServices] Shared services destroyed");
}
