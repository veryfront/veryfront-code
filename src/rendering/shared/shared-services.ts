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

import { rendererLogger as logger } from "#veryfront/utils";
import { initialize as initializeEsbuild } from "esbuild";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { ElementValidator, type ValidationOptions } from "../element-validator/index.ts";
import { type CompileMDXFunction, CompilerService } from "../orchestrator/compiler-service.ts";

/**
 * Initialization options for shared services
 */
export interface SharedServicesOptions {
  /** Debug mode for element validation */
  debugMode?: boolean;
  /** Max depth for element validation */
  maxValidationDepth?: number;
}

/**
 * Collection of shared services that can be used across all projects
 */
export interface SharedServices {
  /** Element validator (pure validation, no project state) */
  elementValidator: ElementValidator;

  /** Compiler service (late-binding MDX compiler) */
  compilerService: CompilerService;

  /** Whether esbuild has been initialized */
  esbuildInitialized: boolean;
}

/**
 * Singleton state for shared services
 */
let sharedServices: SharedServices | null = null;
let initializationPromise: Promise<SharedServices> | null = null;

/**
 * Initialize shared services (called once at startup)
 *
 * This function is idempotent - calling it multiple times will return
 * the same singleton instance. Concurrent calls will wait for the
 * first initialization to complete.
 *
 * @param options - Configuration options
 * @returns Shared services singleton
 */
export async function initializeSharedServices(
  options: SharedServicesOptions = {},
): Promise<SharedServices> {
  // Return existing singleton if available
  if (sharedServices) {
    return sharedServices;
  }

  // Wait for in-flight initialization if one exists
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization (withSpan is intentionally not awaited here to support concurrent initialization)
  initializationPromise = withSpan(
    SpanNames.SHARED_SERVICES_INIT,
    async () => {
      logger.debug("[SharedServices] Initializing shared renderer services");
      const startTime = performance.now();

      // Initialize esbuild (expensive, do once)
      let esbuildInitialized = false;
      try {
        await initializeEsbuild({ worker: false });
        esbuildInitialized = true;
        logger.debug("[SharedServices] esbuild initialized");
      } catch {
        // Already initialized
        esbuildInitialized = true;
      }

      // Create element validator (stateless)
      const validatorOptions: ValidationOptions = {
        maxDepth: options.maxValidationDepth ?? 20,
        debugMode: options.debugMode ?? false,
      };
      const elementValidator = new ElementValidator(validatorOptions);

      // Create compiler service (late-binding)
      const compilerService = new CompilerService();

      sharedServices = {
        elementValidator,
        compilerService,
        esbuildInitialized,
      };

      const duration = performance.now() - startTime;
      logger.debug("[SharedServices] Shared services initialized", {
        duration: `${duration.toFixed(2)}ms`,
      });

      return sharedServices;
    },
    {
      "shared_services.debug_mode": options.debugMode ?? false,
      "shared_services.max_validation_depth": options.maxValidationDepth ?? 20,
    },
  );

  try {
    return await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

/**
 * Get the shared services singleton
 *
 * @throws Error if services haven't been initialized
 * @returns Shared services singleton
 */
export function getSharedServices(): SharedServices {
  if (!sharedServices) {
    throw new Error(
      "SharedServices not initialized. Call initializeSharedServices() first.",
    );
  }
  return sharedServices;
}

/**
 * Check if shared services have been initialized
 */
export function areSharedServicesInitialized(): boolean {
  return sharedServices !== null;
}

/**
 * Set the MDX compile function on the shared compiler service
 *
 * This must be called after initialization to provide the actual
 * MDX compilation implementation.
 *
 * @param compileMDX - MDX compilation function
 */
export function setSharedCompileMDX(compileMDX: CompileMDXFunction): void {
  const services = getSharedServices();
  services.compilerService.setCompileMDX(compileMDX);
}

/**
 * Get the shared MDX compile function
 *
 * Returns a bound function that can be passed to services that
 * need MDX compilation capability.
 *
 * @returns Bound compile function
 */
export function getSharedCompileMDX(): CompileMDXFunction {
  const services = getSharedServices();
  return services.compilerService.getCompileFunction();
}

/**
 * Destroy shared services (for testing or shutdown)
 *
 * After calling this, initializeSharedServices() must be called
 * again before using any shared services.
 */
export function destroySharedServices(): void {
  sharedServices = null;
  initializationPromise = null;
  logger.debug("[SharedServices] Shared services destroyed");
}
