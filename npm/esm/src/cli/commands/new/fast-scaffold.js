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
import { createFileSystem } from "../../../platform/compat/fs.js";
import { dirname, join } from "../../../platform/compat/path/index.js";
import { getTemplate } from "../../templates/index.js";
import { loadIntegrationBaseFilesFromDirectory, loadIntegrations, } from "../../templates/integration-loader.js";
/**
 * Scaffold a project without any prompts.
 * Uses the AI template by default and creates placeholder env values.
 */
export async function scaffoldProjectFast(projectDir, template = "ai", slug, integrations = []) {
    const fs = createFileSystem();
    const templateFiles = await getTemplate(template);
    if (!templateFiles?.length) {
        throw new Error(`Template "${template}" not found`);
    }
    const integrationFiles = [];
    const integrationEnvVars = [];
    if (integrations.length) {
        integrationFiles.push(...(await loadIntegrationBaseFilesFromDirectory()));
        const { files, integrations: loadedIntegrations } = await loadIntegrations(integrations);
        integrationFiles.push(...files);
        for (const integration of loadedIntegrations) {
            for (const envVar of integration.config.envVars ?? []) {
                integrationEnvVars.push({
                    name: envVar.name,
                    placeholder: envVar.description ?? `your-${envVar.name.toLowerCase().replace(/_/g, "-")}`,
                });
            }
        }
    }
    const allFiles = [
        ...templateFiles,
        ...integrationFiles,
        createVeryfrontConfig(slug, template),
        createEnvFile(template, integrationEnvVars),
        createEnvExampleFile(template, integrationEnvVars),
    ];
    const fileMap = new Map();
    for (const file of allFiles)
        fileMap.set(file.path, file);
    const uniqueFiles = [...fileMap.values()];
    await Promise.all(uniqueFiles.map(async (file) => {
        const filePath = join(projectDir, file.path);
        await fs.mkdir(dirname(filePath), { recursive: true });
        await fs.writeTextFile(filePath, file.content);
    }));
    return {
        filesWritten: uniqueFiles.length,
        template,
        integrations,
        slug,
    };
}
/**
 * Create veryfront.config.ts with projectSlug
 */
function createVeryfrontConfig(slug, template) {
    const usesAppRouter = ["ai", "minimal", "app", "blog", "docs"].includes(template);
    let extras = "";
    if (template === "app") {
        extras = `
  // Theme
  theme: {
    colors: {
      primary: "#6366F1",
      secondary: "#EC4899",
      success: "#10B981",
      danger: "#EF4444",
    },
  },
`;
    }
    const routerConfig = usesAppRouter ? `\n  router: "app",` : "";
    return {
        path: "veryfront.config.ts",
        content: `import type { VeryfrontConfig } from "veryfront";

const config: VeryfrontConfig = {
  projectSlug: "${slug}",${routerConfig}
${extras}
  // Development
  dev: {
    open: true,
  },
};

export default config;
`,
    };
}
/**
 * Create .env file with placeholder values
 */
function createEnvFile(template, integrationEnvVars = []) {
    const envVars = {};
    if (template === "ai") {
        envVars.OPENAI_API_KEY = "sk-your-openai-api-key";
    }
    for (const { name, placeholder } of integrationEnvVars) {
        envVars[name] = placeholder;
    }
    const content = Object.entries(envVars)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n") + "\n";
    return { path: ".env", content };
}
/**
 * Create .env.example file with documentation
 */
function createEnvExampleFile(template, integrationEnvVars = []) {
    const lines = [
        "# Environment variables",
        "# Copy this file to .env and fill in your values",
        "",
    ];
    if (template === "ai") {
        lines.push("# OpenAI API key (https://platform.openai.com/api-keys)");
        lines.push("OPENAI_API_KEY=sk-...");
        lines.push("");
    }
    if (integrationEnvVars.length) {
        lines.push("# Integration credentials");
        for (const { name, placeholder } of integrationEnvVars) {
            lines.push(`${name}=${placeholder}`);
        }
    }
    return {
        path: ".env.example",
        content: `${lines.join("\n")}\n`,
    };
}
