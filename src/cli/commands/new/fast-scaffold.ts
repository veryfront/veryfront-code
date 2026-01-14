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

import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { dirname, join } from "@veryfront/platform/compat/path/index.ts";
import { getTemplate } from "../../templates/index.ts";
import { loadIntegrations, loadIntegrationBaseFilesFromDirectory } from "../../templates/integration-loader.ts";
import type { InitTemplate } from "../init/types.ts";
import type { IntegrationName, TemplateFile } from "../../templates/types.ts";

// ============================================================================
// Types
// ============================================================================

export interface ScaffoldResult {
  filesWritten: number;
  template: InitTemplate;
  integrations: IntegrationName[];
  slug: string;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Scaffold a project without any prompts.
 * Uses the AI template by default and creates placeholder env values.
 */
export async function scaffoldProjectFast(
  projectDir: string,
  template: InitTemplate = "ai",
  slug: string,
  integrations: IntegrationName[] = [],
): Promise<ScaffoldResult> {
  const fs = createFileSystem();

  // Load template files
  const templateFiles = await getTemplate(template);
  if (!templateFiles || templateFiles.length === 0) {
    throw new Error(`Template "${template}" not found`);
  }

  // Load integration files if any
  const integrationFiles: TemplateFile[] = [];
  const integrationEnvVars: Array<{ name: string; placeholder: string }> = [];

  if (integrations.length > 0) {
    // Load base integration files (shared OAuth utilities)
    const baseFiles = await loadIntegrationBaseFilesFromDirectory();
    integrationFiles.push(...baseFiles);

    // Load selected integration files
    const { files, integrations: loadedIntegrations } = await loadIntegrations(integrations);
    integrationFiles.push(...files);

    // Collect env vars from integrations
    for (const integration of loadedIntegrations) {
      if (integration.config.envVars) {
        for (const envVar of integration.config.envVars) {
          integrationEnvVars.push({
            name: envVar.name,
            placeholder: envVar.description || `your-${envVar.name.toLowerCase().replace(/_/g, "-")}`,
          });
        }
      }
    }
  }

  // Add additional files
  const allFiles: TemplateFile[] = [
    ...templateFiles,
    ...integrationFiles,
    createVeryfrontRc(slug),
    createEnvFile(template, integrationEnvVars),
    createEnvExampleFile(template, integrationEnvVars),
  ];

  // Filter out any duplicate paths (prefer later files)
  const fileMap = new Map<string, TemplateFile>();
  for (const file of allFiles) {
    fileMap.set(file.path, file);
  }
  const uniqueFiles = Array.from(fileMap.values());

  // Write all files in parallel
  const writePromises = uniqueFiles.map(async (file) => {
    const filePath = join(projectDir, file.path);
    const fileDir = dirname(filePath);

    // Ensure directory exists
    await fs.mkdir(fileDir, { recursive: true });

    // Write file
    await fs.writeTextFile(filePath, file.content);
  });

  await Promise.all(writePromises);

  return {
    filesWritten: uniqueFiles.length,
    template,
    integrations,
    slug,
  };
}

// ============================================================================
// File Generators
// ============================================================================

/**
 * Create .veryfrontrc config file
 */
function createVeryfrontRc(slug: string): TemplateFile {
  return {
    path: ".veryfrontrc",
    content: JSON.stringify({ projectSlug: slug }, null, 2) + "\n",
  };
}

/**
 * Create .env file with placeholder values
 */
function createEnvFile(
  template: InitTemplate,
  integrationEnvVars: Array<{ name: string; placeholder: string }> = [],
): TemplateFile {
  const envVars: Record<string, string> = {};

  // Add template-specific env vars
  if (template === "ai") {
    envVars["OPENAI_API_KEY"] = "sk-your-openai-api-key";
  }

  // Add integration env vars
  for (const { name, placeholder } of integrationEnvVars) {
    envVars[name] = placeholder;
  }

  const content = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  return {
    path: ".env",
    content: content + "\n",
  };
}

/**
 * Create .env.example file with documentation
 */
function createEnvExampleFile(
  template: InitTemplate,
  integrationEnvVars: Array<{ name: string; placeholder: string }> = [],
): TemplateFile {
  const lines: string[] = [
    "# Environment variables",
    "# Copy this file to .env and fill in your values",
    "",
  ];

  if (template === "ai") {
    lines.push("# OpenAI API key (https://platform.openai.com/api-keys)");
    lines.push("OPENAI_API_KEY=sk-...");
    lines.push("");
  }

  // Add integration env vars
  if (integrationEnvVars.length > 0) {
    lines.push("# Integration credentials");
    for (const { name, placeholder } of integrationEnvVars) {
      lines.push(`${name}=${placeholder}`);
    }
  }

  return {
    path: ".env.example",
    content: lines.join("\n") + "\n",
  };
}
