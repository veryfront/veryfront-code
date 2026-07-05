import { cliLogger as logger, VERSION } from "#cli/utils";
import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";

// Keep init scaffold aligned with current framework default React major/minor.
const DEFAULT_INIT_REACT_VERSION = "19.2.4";
const REQUIRED_INIT_EXTENSION_PACKAGES = [
  "@veryfront/ext-bundler-esbuild",
  "@veryfront/ext-content-mdx",
  "@veryfront/ext-css-tailwind",
  "@veryfront/ext-parser-babel",
] as const;

export interface CreatePackageJsonOptions {
  /** Template-owned dependencies that must be installed for generated apps. */
  dependencies?: Record<string, string>;
  /**
   * Selected integrations whose `connector.json#npmDependencies` should be
   * merged into the generated project's `package.json#dependencies`.
   * First declaration wins on version collisions; framework pins
   * (react, react-dom, veryfront, zod) always take precedence.
   */
  integrations?: Array<{
    name: string;
    npmDependencies?: Record<string, string>;
  }>;
}

export async function createPackageJson(
  projectDir: string,
  projectName?: string,
  options: CreatePackageJsonOptions = {},
): Promise<void> {
  const fs = createFileSystem();

  // Read any existing package.json (e.g. from template) to merge dependencies
  const templateDeps: Record<string, string> = { ...(options.dependencies ?? {}) };
  const pkgPath = join(projectDir, "package.json");
  if (await fs.exists(pkgPath)) {
    const existing = JSON.parse(await fs.readTextFile(pkgPath));
    Object.assign(templateDeps, existing.dependencies ?? {});
  }

  // Merge per-integration deps. First declaration wins; collisions are logged.
  const integrationDeps: Record<string, string> = {};
  for (const integration of options.integrations ?? []) {
    for (const [pkg, range] of Object.entries(integration.npmDependencies ?? {})) {
      if (pkg in integrationDeps) {
        if (integrationDeps[pkg] !== range) {
          logger.warn(
            `[init] ${integration.name} requested ${pkg}@${range} but ${pkg}@${
              integrationDeps[pkg]
            } is already pinned by an earlier integration - keeping the earlier pin`,
          );
        }
        continue;
      }
      integrationDeps[pkg] = range;
    }
  }

  const dirName = projectDir.split(/[/\\]/).pop();
  const veryfrontVersionRange = `^${VERSION}`;
  const requiredExtensionDeps = Object.fromEntries(
    REQUIRED_INIT_EXTENSION_PACKAGES.map((packageName) => [packageName, veryfrontVersionRange]),
  );
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
      ...integrationDeps,
      ...requiredExtensionDeps,
      react: `^${DEFAULT_INIT_REACT_VERSION}`,
      "react-dom": `^${DEFAULT_INIT_REACT_VERSION}`,
      veryfront: veryfrontVersionRange,
      zod: "^3.24.0",
    },
  };

  await fs.writeTextFile(
    join(projectDir, "package.json"),
    JSON.stringify(packageJson, null, 2),
  );

  logger.debug('Created package.json with "type": "module"');
}
