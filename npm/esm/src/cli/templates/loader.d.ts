/**
 * Template loader using JSON manifest.
 *
 * Templates are compiled to a JSON manifest at build time, which allows
 * them to be embedded in compiled binaries without deno compile trying
 * to analyze them as TypeScript modules.
 */
import type { TemplateFile } from "./types.js";
export declare function loadTemplateFromDirectory(templateName: string): Promise<TemplateFile[]>;
export declare function getTemplateDirectory(templateName: string): string;
export declare function templateDirectoryExists(templateName: string): Promise<boolean>;
export declare function getIntegrationTemplate(integrationName: string): TemplateFile[] | null;
export declare function listTemplates(): string[];
export declare function listIntegrations(): string[];
//# sourceMappingURL=loader.d.ts.map