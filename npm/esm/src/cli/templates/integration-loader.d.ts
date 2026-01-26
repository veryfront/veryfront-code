/**
 * Integration loader for service connectors
 *
 * Loads integrations from the integrations/ directory and handles:
 * - Integration file overlay
 * - OAuth configuration
 * - Tool auto-discovery
 * - Prompt/action loading
 */
import type { IntegrationConfig, IntegrationName, ResolvedIntegration, TemplateFile, UseCaseConfig, UseCaseName } from "./types.js";
/**
 * Available integrations that can be added via --integrations flag
 */
export declare const AVAILABLE_INTEGRATIONS: IntegrationName[];
/**
 * Available use-cases that can be selected via --usecase flag
 */
export declare const AVAILABLE_USECASES: UseCaseName[];
/**
 * Pre-defined use-case configurations
 */
export declare const USE_CASE_CONFIGS: Record<UseCaseName, UseCaseConfig>;
/**
 * Get the directory path for an integration
 */
export declare function getIntegrationDirectory(integrationName: string): string;
/**
 * Load integration configuration from connector.json
 */
export declare function loadIntegrationConfig(integrationName: IntegrationName): Promise<IntegrationConfig | null>;
/**
 * Load an integration with its files
 */
export declare function loadIntegration(integrationName: IntegrationName): Promise<ResolvedIntegration | null>;
/**
 * Validate integration names
 */
export declare function validateIntegrations(integrations: IntegrationName[]): {
    valid: boolean;
    errors: string[];
};
/**
 * Load multiple integrations and merge their files
 */
export declare function loadIntegrations(integrationNames: IntegrationName[]): Promise<{
    integrations: ResolvedIntegration[];
    files: TemplateFile[];
    errors: string[];
}>;
/**
 * Check if an integration exists
 */
export declare function integrationExists(integrationName: string): Promise<boolean>;
/**
 * Get use-case configuration
 */
export declare function getUseCaseConfig(useCaseName: UseCaseName): UseCaseConfig;
/**
 * Get all available prompts for a set of integrations
 */
export declare function getAvailablePrompts(integrationNames: IntegrationName[]): Promise<Array<{
    integration: IntegrationName;
    prompts: IntegrationConfig["prompts"];
}>>;
/**
 * Load base files from the _base integration directory
 * These include setup guide page and status API
 */
export declare function loadIntegrationBaseFilesFromDirectory(): Promise<TemplateFile[]>;
/**
 * Load the _base integration config to get shared env vars like APP_URL
 */
export declare function loadIntegrationBaseConfig(): Promise<IntegrationConfig | null>;
/**
 * Generate base files needed for any integration setup
 * These are shared across all integrations
 */
export declare function getIntegrationBaseFiles(): TemplateFile[];
//# sourceMappingURL=integration-loader.d.ts.map