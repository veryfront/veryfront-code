import { cliLogger as logger, VERSION } from "#cli/utils";
import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";

// Keep init scaffold aligned with current framework default React major/minor.
const DEFAULT_INIT_REACT_VERSION = "19.1.1";

export async function createPackageJson(
  projectDir: string,
  projectName?: string,
): Promise<void> {
  const fs = createFileSystem();

  // Read any existing package.json (e.g. from template) to merge dependencies
  let templateDeps: Record<string, string> = {};
  const pkgPath = join(projectDir, "package.json");
  if (await fs.exists(pkgPath)) {
    const existing = JSON.parse(await fs.readTextFile(pkgPath));
    templateDeps = existing.dependencies ?? {};
  }

  const dirName = projectDir.split(/[/\\]/).pop();
  const packageJson = {
    name: projectName ?? dirName ?? "veryfront-project",
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "veryfront dev",
      build: "veryfront build",
      preview: "veryfront preview",
    },
    pnpm: {
      onlyBuiltDependencies: ["esbuild", "veryfront"],
    },
    dependencies: {
      ...templateDeps,
      react: `^${DEFAULT_INIT_REACT_VERSION}`,
      "react-dom": `^${DEFAULT_INIT_REACT_VERSION}`,
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
