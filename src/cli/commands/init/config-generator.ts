/**
 * Configuration file generation utilities
 * @module
 */

import { cliLogger as logger } from "@veryfront/utils";
import { PATHS } from "@veryfront/utils/paths.ts";
import { join } from "std/path/mod.ts";
import type { CacheBackend, InitTemplate } from "./types.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";

/**
 * Creates the veryfront.config.js file with default settings
 *
 * @param projectDir - Root directory of the project
 * @param name - Project name (optional, defaults to "My App")
 * @param template - Template type affecting config defaults
 * @throws {Error} If file write fails
 *
 * @example
 * ```ts
 * await createConfigFile('/path/to/project', 'my-app', 'pages-router')
 * ```
 */
export async function createConfigFile(
  projectDir: string,
  name: string | undefined,
  template: InitTemplate | undefined,
  cacheBackend: CacheBackend,
): Promise<void> {
  const config = `export default {
  title: "${name || "My App"}",
  description: "Built with Veryfront",

  // Theme configuration
  theme: {
    colors: {
      primary: "#3B82F6",
    },
  },

  // Development server
  dev: {
    port: 3002,
    open: true,
  },

  // Import map
  resolve: {
    importMap: {
      imports: {
        "react": "https://esm.sh/react@19.1.1",
        "react/jsx-runtime": "https://esm.sh/react@19.1.1/jsx-runtime",
        "react/jsx-dev-runtime": "https://esm.sh/react@19.1.1/jsx-dev-runtime",
        "react-dom": "https://esm.sh/react-dom@19.1.1",
        "react-dom/client": "https://esm.sh/react-dom@19.1.1/client",
        "react-dom/server": "https://esm.sh/react-dom@19.1.1/server",
      },
    },
  },

  // Generation preferences
  generate: {
    preferredRouter: "${
    template === "app-router" || template === "app-router-api" ? "app-router" : "pages-router"
  }",
  },

  // MDX configuration
  mdx: {
    remarkPlugins: [
      // Your custom remark plugins
    ],
    rehypePlugins: [
      // Your custom rehype plugins
    ],
  },

  // Cache configuration
  cache: {
    dir: ".veryfront/cache",
    render: {
      // Available options: memory | filesystem | kv | redis
      type: "${cacheBackend}",
      ttl: 60 * 1000,
      maxEntries: 200,
    },
  },
};
`;

  const fs = createFileSystem();
  await fs.writeTextFile(join(projectDir, PATHS.CONFIG_FILE), config);
  logger.debug(`Created config file: ${PATHS.CONFIG_FILE}`);
}

/**
 * Creates a package.json file with ES module support
 *
 * @param projectDir - Root directory of the project
 * @param projectName - Name of the project
 */
export async function createPackageJson(
  projectDir: string,
  projectName?: string,
): Promise<void> {
  const packageJson = {
    name: projectName || "veryfront-project",
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "veryfront dev",
      build: "veryfront build",
      preview: "veryfront preview",
    },
    dependencies: {
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      zod: "^3.24.0",
    },
  };

  const fs = createFileSystem();
  await fs.writeTextFile(
    join(projectDir, "package.json"),
    JSON.stringify(packageJson, null, 2),
  );
  logger.debug(`Created package.json with "type": "module"`);
}

/**
 * Updates the render cache backend inside veryfront.config.js
 *
 * @param projectDir - Root directory containing the config file
 * @param backend - Desired cache backend
 */
export async function updateConfigCacheBlock(
  projectDir: string,
  backend: CacheBackend,
): Promise<void> {
  const fs = createFileSystem();
  const configPath = join(projectDir, PATHS.CONFIG_FILE);

  let content: string;
  try {
    content = await fs.readTextFile(configPath);
  } catch (error) {
    logger.warn(
      `Could not read ${PATHS.CONFIG_FILE} to update cache backend: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

  const renderTypePattern =
    /(cache\s*:\s*\{[\s\S]*?render\s*:\s*\{[\s\S]*?type\s*:\s*)([^,\n]+)(\s*,?)/;
  if (!renderTypePattern.test(content)) {
    logger.warn(
      `Could not locate cache.render.type in ${PATHS.CONFIG_FILE}; skipping cache backend update`,
    );
    return;
  }

  const updated = content.replace(renderTypePattern, `$1"${backend}"$3`);

  if (updated === content) {
    return;
  }

  await fs.writeTextFile(configPath, updated);
  logger.debug(`Updated cache.render.type to "${backend}" in ${PATHS.CONFIG_FILE}`);
}
