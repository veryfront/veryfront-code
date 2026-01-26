/**
 * Deploy command - Create a release and deploy to an environment
 *
 * Creates a new release from the specified branch (default: main)
 * and deploys it to the target environment (default: production).
 *
 * @module cli/commands/deploy
 */
import { z } from "zod";
import { type ApiClient } from "../shared/config.js";
import type { ParsedArgs } from "../index/types.js";
/**
 * Zod schema for deploy command arguments
 */
export declare const DeployArgsSchema: z.ZodObject<{
    branch: z.ZodDefault<z.ZodString>;
    env: z.ZodDefault<z.ZodString>;
    releaseName: z.ZodOptional<z.ZodString>;
    dryRun: z.ZodDefault<z.ZodBoolean>;
    force: z.ZodDefault<z.ZodBoolean>;
    /** Quiet mode - suppress spinner/progress output */
    quiet: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    env: string;
    force: boolean;
    branch: string;
    quiet: boolean;
    dryRun: boolean;
    releaseName?: string | undefined;
}, {
    env?: string | undefined;
    force?: boolean | undefined;
    branch?: string | undefined;
    quiet?: boolean | undefined;
    dryRun?: boolean | undefined;
    releaseName?: string | undefined;
}>;
/**
 * Deploy command options (inferred from schema)
 */
export type DeployOptions = z.infer<typeof DeployArgsSchema>;
/**
 * Parse CLI arguments into validated DeployOptions
 */
export declare function parseDeployArgs(args: ParsedArgs): z.SafeParseReturnType<unknown, DeployOptions>;
/**
 * Environment from the API
 */
interface Environment {
    id: string;
    name: string;
    protected: boolean;
}
/**
 * Release from the API
 */
interface Release {
    id: string;
    name: string;
    version: string;
    export_status: string;
    build_status: string;
    deploy_status: string;
}
/**
 * Deployment from the API
 */
interface Deployment {
    id: string;
    release: string;
    environment: string;
}
/**
 * Get environment by name (with pagination support)
 */
export declare function getEnvironmentByName(client: ApiClient, projectSlug: string, name: string): Promise<Environment | null>;
/**
 * Create a new release
 */
export declare function createRelease(client: ApiClient, projectSlug: string, options?: {
    name?: string;
    branch?: string;
}): Promise<Release>;
/**
 * Create a new deployment
 */
export declare function createDeployment(client: ApiClient, projectSlug: string, releaseId: string, environmentId: string): Promise<Deployment>;
/**
 * Create a release and deploy to an environment
 */
export declare function deployCommand(options: DeployOptions): Promise<void>;
export {};
//# sourceMappingURL=deploy.d.ts.map