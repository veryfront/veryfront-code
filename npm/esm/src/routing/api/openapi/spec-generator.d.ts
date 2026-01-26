/**
 * OpenAPI Spec Generator
 *
 * Generates OpenAPI 3.1.0 specification from discovered routes.
 *
 * @module routing/api/openapi/spec-generator
 */
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../../config/index.js";
import type { DynamicRouter } from "../api-route-matcher.js";
import { type OpenAPISpec } from "./types.js";
export interface GenerateSpecOptions {
    /** API title for OpenAPI info */
    title?: string;
    /** API version */
    version?: string;
    /** API description */
    description?: string;
    /** Server URLs to include */
    servers?: Array<{
        url: string;
        description?: string;
    }>;
}
export declare function generateOpenAPISpec(router: DynamicRouter, projectDir: string, adapter: RuntimeAdapter, config?: VeryfrontConfig, options?: GenerateSpecOptions): Promise<OpenAPISpec>;
export declare function generateOpenAPIJson(router: DynamicRouter, projectDir: string, adapter: RuntimeAdapter, config?: VeryfrontConfig, options?: GenerateSpecOptions): Promise<string>;
export declare function specToYaml(spec: OpenAPISpec): string;
//# sourceMappingURL=spec-generator.d.ts.map