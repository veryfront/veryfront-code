import { cliLogger as logger, VERSION } from "#cli/utils";
import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";

export async function createPackageJson(
  projectDir: string,
  projectName?: string,
): Promise<void> {
  const fs = createFileSystem();

  const packageJson = {
    name: projectName ?? "veryfront-project",
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
      veryfront: `^${VERSION}`,
      zod: "^3.24.0",
    },
  };

  await fs.writeTextFile(
    join(projectDir, "package.json"),
    JSON.stringify(packageJson, null, 2),
  );

  logger.debug('Created package.json with "type": "module"');
}
