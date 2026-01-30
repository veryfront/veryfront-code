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
import { ElementValidator } from "../element-validator/index.js";
import { CompilerService } from "../orchestrator/compiler-service.js";
let sharedServices = null;
let initializationPromise = null;
export async function initializeSharedServices(options = {}) {
    if (sharedServices)
        return sharedServices;
    if (initializationPromise)
        return initializationPromise;
    const debugMode = options.debugMode ?? false;
    const maxValidationDepth = options.maxValidationDepth ?? 20;
    initializationPromise = withSpan(SpanNames.SHARED_SERVICES_INIT, async () => {
        logger.debug("[SharedServices] Initializing shared renderer services");
        const startTime = performance.now();
        // Initialize JSX transform (esbuild in dev, sucrase in deno compile)
        await initializeTransform();
        logger.debug("[SharedServices] Transform initialized", {
            backend: isUsingEsbuild() ? "esbuild" : "sucrase",
        });
        const validatorOptions = {
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
    }, {
        "shared_services.debug_mode": debugMode,
        "shared_services.max_validation_depth": maxValidationDepth,
    });
    try {
        return await initializationPromise;
    }
    finally {
        initializationPromise = null;
    }
}
export function getSharedServices() {
    if (!sharedServices) {
        throw new Error("SharedServices not initialized. Call initializeSharedServices() first.");
    }
    return sharedServices;
}
export function areSharedServicesInitialized() {
    return sharedServices !== null;
}
export function setSharedCompileMDX(compileMDX) {
    getSharedServices().compilerService.setCompileMDX(compileMDX);
}
export function getSharedCompileMDX() {
    return getSharedServices().compilerService.getCompileFunction();
}
export function destroySharedServices() {
    sharedServices = null;
    initializationPromise = null;
    logger.debug("[SharedServices] Shared services destroyed");
}
