/**
 * Integration Generator
 *
 * Generates new service integration scaffolds with interactive prompts.
 * Creates connector.json, API client, OAuth routes, token store, and tool skeletons.
 */
export interface IntegrationGeneratorOptions {
    /** Integration name (lowercase, e.g., "twilio") */
    name?: string;
    /** Display name (e.g., "Twilio") */
    displayName?: string;
    /** Authentication type */
    authType?: "oauth2" | "api-key";
    /** API base URL */
    apiBaseUrl?: string;
    /** OAuth authorization URL (for oauth2) */
    authorizationUrl?: string;
    /** OAuth token URL (for oauth2) */
    tokenUrl?: string;
    /** OAuth scopes (comma-separated) */
    scopes?: string;
    /** Skip interactive prompts */
    skipPrompts?: boolean;
}
/**
 * Run the integration generator
 */
export declare function generateIntegration(projectDir: string, options?: IntegrationGeneratorOptions): Promise<void>;
//# sourceMappingURL=integration-generator.d.ts.map