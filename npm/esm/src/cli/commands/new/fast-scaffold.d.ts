/**
 * Fast scaffold - Write template files without any prompts
 *
 * Optimized for speed by:
 * - No interactive prompts
 * - Parallel file writes
 * - Placeholder env values
 *
 * @module cli/commands/new/fast-scaffold
 */
import type { InitTemplate } from "../init/types.js";
import type { IntegrationName } from "../../templates/types.js";
export interface ScaffoldResult {
    filesWritten: number;
    template: InitTemplate;
    integrations: IntegrationName[];
    slug: string;
}
/**
 * Scaffold a project without any prompts.
 * Uses the AI template by default and creates placeholder env values.
 */
export declare function scaffoldProjectFast(projectDir: string, template: InitTemplate | undefined, slug: string, integrations?: IntegrationName[]): Promise<ScaffoldResult>;
//# sourceMappingURL=fast-scaffold.d.ts.map