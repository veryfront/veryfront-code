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
import { ElementValidator } from "../element-validator/index.js";
import { type CompileMDXFunction, CompilerService } from "../orchestrator/compiler-service.js";
export interface SharedServicesOptions {
    debugMode?: boolean;
    maxValidationDepth?: number;
}
export interface SharedServices {
    elementValidator: ElementValidator;
    compilerService: CompilerService;
    esbuildInitialized: boolean;
}
export declare function initializeSharedServices(options?: SharedServicesOptions): Promise<SharedServices>;
export declare function getSharedServices(): SharedServices;
export declare function areSharedServicesInitialized(): boolean;
export declare function setSharedCompileMDX(compileMDX: CompileMDXFunction): void;
export declare function getSharedCompileMDX(): CompileMDXFunction;
export declare function destroySharedServices(): void;
//# sourceMappingURL=shared-services.d.ts.map