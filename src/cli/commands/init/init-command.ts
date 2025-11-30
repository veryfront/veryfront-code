/**
 * Main init command implementation
 * @module
 */

import { cliLogger as logger } from "@veryfront/utils";
import { FileSystemError } from "@veryfront/errors";
import { cyan, green } from "@veryfront/compat/console";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { createConfigFile, createPackageJson, updateConfigCacheBlock } from "./config-generator.ts";
import { createProjectStructure } from "./project-structure.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import {
  createAppRouterApiSample,
  createAppRouterSample,
  createRscDemoSample,
  createSampleFiles,
} from "./sample-generators.ts";
import type { CacheBackend, InitOptions, InitTemplate } from "./types.ts";
import { cwd, getEnv, isInteractive as checkIsInteractive } from "../../../platform/compat/process.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";

const CACHE_BACKENDS: CacheBackend[] = ["memory", "filesystem", "kv", "redis"];

function normalizeBackend(value: string): CacheBackend | null {
  const normalized = value.trim().toLowerCase();
  return CACHE_BACKENDS.find((backend) => backend === normalized) ?? null;
}

function resolveCacheBackend(provided?: string): Promise<CacheBackend> {
  if (provided) {
    const normalized = normalizeBackend(provided);
    if (!normalized) {
      throw toError(createError({
        type: "config",
        message: `Unknown cache backend: ${provided}. Expected one of ${CACHE_BACKENDS.join(", ")}`,
      }));
    }
    return Promise.resolve(normalized);
  }

  try {
    // Prompt only when stdin is interactive and we are not inside CI/tests
    const disablePrompt = getEnv("CI") === "1" || getEnv("DENO_TESTING") === "1";
    const interactive = !disablePrompt && checkIsInteractive();

    if (interactive) {
      const answer = prompt(
        `Select cache backend [memory/filesystem/kv/redis] (default: memory)`,
      );
      if (answer) {
        const normalized = normalizeBackend(answer);
        if (normalized) return Promise.resolve(normalized);
        logger.warn(`Unknown cache backend "${answer}". Using default (memory).`);
      }
    }
  } catch (error) {
    // Prompt may fail in non-interactive environments (e.g., CI)
    logger.debug("Prompt failed (likely non-interactive environment):", error);
  }

  return Promise.resolve("memory");
}

/**
 * Initializes a new Veryfront project with the specified template
 *
 * @param options - Configuration options for project initialization
 * @throws {FileSystemError} If target directory already exists
 * @throws {Error} If template not found or file operations fail
 *
 * @example
 * ```ts
 * // Create new project in current directory
 * await initCommand({ template: 'pages-router' })
 *
 * // Create new project in named directory
 * await initCommand({ name: 'my-app', template: 'app-router' })
 *
 * // Using deprecated appRouter flag (backward compatibility)
 * await initCommand({ name: 'my-app', appRouter: true })
 * ```
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const { name } = options;
  const template: InitTemplate = (options.template as InitTemplate | undefined)
    ? (options.template as InitTemplate)
    : options.appRouter
    ? "app-router"
    : "pages-router";
  const projectDir = name ? join(cwd(), name) : cwd();
  const cacheBackend = await resolveCacheBackend(options.cacheBackend);
  const fs = createFileSystem();

  logger.info(
    `Creating new Veryfront project${name ? ` in ${name}` : ""} with template: ${template}`,
  );
  logger.debug(`Selected render cache backend: ${cacheBackend}`);

  // Check if directory exists
  if (name) {
    const exists = await fs.exists(projectDir);
    if (exists) {
      throw new FileSystemError(`Directory ${name} already exists`);
    }
  }

  // Use new template system for modern templates
  if (["blog", "docs", "app", "minimal", "ai"].includes(template)) {
    const { getTemplate } = await import("../../templates/index.ts");

    const templateFiles = getTemplate(template as "blog" | "docs" | "app" | "minimal" | "ai");

    if (!templateFiles) {
      throw toError(createError({
        type: "config",
        message: `Template ${template} not found`,
      }));
    }

    if (name) {
      await ensureDir(projectDir);
    }

    // Create all template files
    for (const file of templateFiles) {
      const filePath = join(projectDir, file.path);
      const fileDir = join(projectDir, ...file.path.split("/").slice(0, -1));

      if (fileDir !== projectDir) {
        await ensureDir(fileDir);
      }

      await fs.writeTextFile(filePath, file.content);
      logger.debug(`Created file: ${file.path}`);
    }

    // Create package.json with ES module support
    await createPackageJson(projectDir, name);
    await updateConfigCacheBlock(projectDir, cacheBackend);
  } else {
    // Legacy template handling
    await createProjectStructure(projectDir, template);
    await createConfigFile(projectDir, name, template, cacheBackend);
    // Create package.json with ES module support
    await createPackageJson(projectDir, name);

    if (template === "app-router") await createAppRouterSample(projectDir);
    else if (template === "app-router-api") {
      await createAppRouterApiSample(projectDir);
    } else if (template === "rsc-demo") await createRscDemoSample(projectDir);
    else await createSampleFiles(projectDir);
  }

  logger.info(`${green("✅")} Created Veryfront project${name ? ` at ${name}` : ""}`);
  logger.info(`\n${cyan("Next steps:")}`);
  if (name) {
    logger.info(`  cd ${name}`);
  }
  logger.info(`  veryfront dev`);

  // Add template-specific instructions
  if (template === "blog") {
    logger.info(`\n${cyan("Blog tips:")}`);
    logger.info(`  - Add posts to content/posts/`);
    logger.info(`  - Customize layout in app/layout.tsx`);
    logger.info(`  - Configure blog settings in veryfront.config.js`);
  } else if (template === "docs") {
    logger.info(`\n${cyan("Documentation tips:")}`);
    logger.info(`  - Add docs to app/docs/`);
    logger.info(`  - Update navigation in components/Sidebar.tsx`);
    logger.info(`  - Enable search in veryfront.config.js`);
  } else if (template === "app") {
    logger.info(`\n${cyan("App tips:")}`);
    logger.info(`  - Default login: demo@example.com / password`);
    logger.info(`  - Add API routes in app/api/`);
    logger.info(`  - Configure auth in lib/auth.ts`);
  } else if (template === "ai") {
    logger.info(`\n${cyan("AI Starter tips:")}`);
    logger.info(`  - Add your API Key to .env`);
    logger.info(`  - Define new tools in ai/agent.ts`);
    logger.info(`  - Configure providers in veryfront.config.js`);
  }
}
