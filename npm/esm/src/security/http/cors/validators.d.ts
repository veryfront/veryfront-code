import type { CORSConfig, CORSValidationResult } from "./types.js";
/** Validate origin against CORS configuration */
export declare function validateOrigin(requestOrigin: string | null, config?: boolean | CORSConfig): Promise<CORSValidationResult>;
/** Synchronous origin validation (async validators not supported) */
export declare function validateOriginSync(requestOrigin: string | null, config?: boolean | CORSConfig): CORSValidationResult;
/** Validate CORS configuration for security issues */
export declare function validateCORSConfig(config?: boolean | CORSConfig): {
    valid: boolean;
    error?: string;
};
//# sourceMappingURL=validators.d.ts.map