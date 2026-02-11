import { createFileSystem } from "veryfront/platform";
import { dirname, join } from "veryfront/platform/path";
import { getTemplate } from "../../templates/index.ts";
import {
  loadIntegrationBaseFilesFromDirectory,
  loadIntegrations,
} from "../../templates/integration-loader.ts";
import type { InitTemplate } from "../init/types.ts";
import type { IntegrationName, TemplateFile } from "../../templates/types.ts";

export interface ScaffoldResult {
  filesWritten: number;
  template: InitTemplate;
  integrations: IntegrationName[];
  slug: string;
}

export async function scaffoldProjectFast(
  projectDir: string,
  template: InitTemplate = "chat",
  slug: string,
  integrations: IntegrationName[] = [],
): Promise<ScaffoldResult> {
  const fs = createFileSystem();

  const templateFiles = await getTemplate(template);
  if (!templateFiles?.length) throw new Error(`Template "${template}" not found`);

  const integrationFiles: TemplateFile[] = [];
  const integrationEnvVars: Array<{ name: string; placeholder: string }> = [];

  if (integrations.length) {
    integrationFiles.push(...(await loadIntegrationBaseFilesFromDirectory()));

    const { files, integrations: loadedIntegrations } = await loadIntegrations(integrations);
    integrationFiles.push(...files);

    for (const integration of loadedIntegrations) {
      for (const envVar of integration.config.envVars ?? []) {
        integrationEnvVars.push({
          name: envVar.name,
          placeholder: envVar.description ??
            `your-${envVar.name.toLowerCase().replace(/_/g, "-")}`,
        });
      }
    }
  }

  const uniqueFiles = dedupeFilesByPath([
    ...templateFiles,
    ...integrationFiles,
    createVeryfrontConfig(slug, template),
    createEnvFile(template, integrationEnvVars),
    createEnvExampleFile(template, integrationEnvVars),
  ]);

  await Promise.all(
    uniqueFiles.map(async (file) => {
      const filePath = join(projectDir, file.path);
      await fs.mkdir(dirname(filePath), { recursive: true });
      await fs.writeTextFile(filePath, file.content);
    }),
  );

  return {
    filesWritten: uniqueFiles.length,
    template,
    integrations,
    slug,
  };
}

function dedupeFilesByPath(files: TemplateFile[]): TemplateFile[] {
  const fileMap = new Map<string, TemplateFile>();
  for (const file of files) fileMap.set(file.path, file);
  return [...fileMap.values()];
}

function createVeryfrontConfig(slug: string, template: InitTemplate): TemplateFile {
  const usesAppRouter = [
    "chat",
    "rag",
    "multi-agent",
    "workflow",
    "coding-agent",
    "saas",
    "minimal",
  ].includes(template);

  const routerConfig = usesAppRouter ? `\n  router: "app",` : "";

  const extras = "";

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

function createEnvFile(
  template: InitTemplate,
  integrationEnvVars: Array<{ name: string; placeholder: string }> = [],
): TemplateFile {
  const envVars: Record<string, string> = {};

  if (template !== "minimal") envVars.OPENAI_API_KEY = "sk-your-openai-api-key";

  for (const { name, placeholder } of integrationEnvVars) {
    envVars[name] = placeholder;
  }

  const content = `${
    Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")
  }\n`;

  return { path: ".env", content };
}

function createEnvExampleFile(
  template: InitTemplate,
  integrationEnvVars: Array<{ name: string; placeholder: string }> = [],
): TemplateFile {
  const lines: string[] = [
    "# Environment variables",
    "# Copy this file to .env and fill in your values",
    "",
  ];

  if (template !== "minimal") {
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
