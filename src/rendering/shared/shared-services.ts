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

import { rendererLogger } from "#veryfront/utils";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { initializeTransform, isUsingEsbuild } from "#veryfront/platform/compat/transform.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ElementValidator, type ValidationOptions } from "../element-validator/index.ts";
import { type CompileMDXFunction, CompilerService } from "../orchestrator/compiler-service.ts";

const logger = rendererLogger.component("shared-services");

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
let sharedServicesGeneration = 0;

export async function initializeSharedServices(
  options: SharedServicesOptions = {},
): Promise<SharedServices> {
  if (sharedServices) return sharedServices;
  if (initializationPromise) return initializationPromise;

  const debugMode = options.debugMode ?? false;
  const maxValidationDepth = options.maxValidationDepth ?? 20;
  const generation = sharedServicesGeneration;

  const initialization = withSpan(
    SpanNames.SHARED_SERVICES_INIT,
    async (): Promise<SharedServices> => {
      logger.debug("Initializing shared renderer services");
      const startTime = performance.now();

      // Initialize JSX transform (esbuild in dev, sucrase in deno compile)
      await initializeTransform();
      logger.debug("Transform initialized", {
        backend: isUsingEsbuild() ? "esbuild" : "sucrase",
      });

      const validatorOptions: ValidationOptions = {
        maxDepth: maxValidationDepth,
        debugMode,
      };

      const nextSharedServices = {
        elementValidator: new ElementValidator(validatorOptions),
        compilerService: new CompilerService(),
      };

      if (generation !== sharedServicesGeneration) {
        throw INITIALIZATION_ERROR.create({
          detail: "Shared services initialization was cancelled before it completed.",
        });
      }

      sharedServices = nextSharedServices;

      logger.debug("Shared services initialized", {
        duration: `${(performance.now() - startTime).toFixed(2)}ms`,
      });

      return nextSharedServices;
    },
    {
      "shared_services.debug_mode": debugMode,
      "shared_services.max_validation_depth": maxValidationDepth,
    },
  );
  initializationPromise = initialization;

  try {
    return await initialization;
  } finally {
    if (initializationPromise === initialization) {
      initializationPromise = null;
    }
  }
}

export function getSharedServices(): SharedServices {
  if (!sharedServices) {
    throw INITIALIZATION_ERROR.create({
      detail: "SharedServices not initialized. Call initializeSharedServices() first.",
    });
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
  sharedServicesGeneration++;
  sharedServices = null;
  initializationPromise = null;
  logger.debug("Shared services destroyed");
}
