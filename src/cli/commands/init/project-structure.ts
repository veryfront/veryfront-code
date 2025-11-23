/**
 * Project structure creation utilities
 * @module
 */

import { cliLogger as logger } from "@veryfront/utils";
import { PATHS } from "@veryfront/utils/paths.ts";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import type { InitTemplate } from "./types.ts";

/**
 * Creates the directory structure for a new project based on template
 *
 * @param projectDir - Root directory of the project
 * @param template - Template type determining structure
 * @throws {Error} If directory creation fails
 *
 * @example
 * ```ts
 * await createProjectStructure('/path/to/project', 'pages-router')
 * ```
 */
export async function createProjectStructure(
  projectDir: string,
  template: InitTemplate,
): Promise<void> {
  const dirs = template === "app-router" || template === "app-router-api" || template === "rsc-demo"
    ? ["app", PATHS.PUBLIC_DIR, PATHS.STYLES_DIR]
    : [
      PATHS.PAGES_DIR,
      PATHS.COMPONENTS_DIR,
      PATHS.PUBLIC_DIR,
      PATHS.STYLES_DIR,
      "layouts",
      "providers",
    ];

  for (const dir of dirs) {
    await ensureDir(join(projectDir, dir));
    logger.debug(`Created directory: ${dir}`);
  }
}
