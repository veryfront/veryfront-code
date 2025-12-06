/**
 * Configuration file generation utilities
 * @module
 */

import { cliLogger as logger } from "@veryfront/utils";
import { join } from "std/path/mod.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";

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
      veryfront: "^0.0.46",
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
