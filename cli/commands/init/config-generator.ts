import { cliLogger as logger, VERSION } from "#cli/utils";
import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";

// Keep init scaffold aligned with current framework default React major/minor.
const DEFAULT_INIT_REACT_VERSION = "19.2.4";

// The scaffold ships a tsconfig.json and a `typecheck` script, so the compiler
// and the React types it needs have to belong to the generated app rather than
// to whatever a package manager happens to hoist. npm and bun flatten
// veryfront's transitive `@types/react` to the project root and pnpm does not,
// so without these the identical scaffold typechecks under npm and fails under
// pnpm with TS7016 on `react/jsx-runtime`.
const DEFAULT_INIT_REACT_TYPES_VERSION = "19.2.0";
const DEFAULT_INIT_TYPESCRIPT_VERSION = "5.9.0";

export interface CreatePackageJsonOptions {
  /** Template-owned dependencies that must be installed for generated apps. */
  dependencies?: Record<string, string>;
  /** Template-owned first-party extension packages aligned to the Veryfront version. */
  firstPartyExtensions?: readonly string[];
  /**
   * Selected integrations whose `connector.json#npmDependencies` should be
   * merged into the generated project's `package.json#dependencies`.
   * First declaration wins on version collisions; framework pins
   * (react, react-dom, veryfront) always take precedence.
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
  const firstPartyExtensionPackages = options.firstPartyExtensions ?? [];
  const requiredExtensionDeps = Object.fromEntries(
    [...new Set(firstPartyExtensionPackages)].map((packageName) => [
      packageName,
      veryfrontVersionRange,
    ]),
  );
  const packageJson = {
    name: projectName ?? dirName ?? "veryfront-project",
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "veryfront dev",
      build: "veryfront build",
      start: "veryfront serve",
      eval: "veryfront eval",
      deploy: "veryfront deploy",
      typecheck: "tsc --noEmit",
    },
    pnpm: {
      onlyBuiltDependencies: ["esbuild"],
    },
    dependencies: {
      ...templateDeps,
      ...integrationDeps,
      ...requiredExtensionDeps,
      react: `^${DEFAULT_INIT_REACT_VERSION}`,
      "react-dom": `^${DEFAULT_INIT_REACT_VERSION}`,
      veryfront: veryfrontVersionRange,
    },
    devDependencies: {
      "@types/react": `^${DEFAULT_INIT_REACT_TYPES_VERSION}`,
      "@types/react-dom": `^${DEFAULT_INIT_REACT_TYPES_VERSION}`,
      typescript: `^${DEFAULT_INIT_TYPESCRIPT_VERSION}`,
    },
  };

  await fs.writeTextFile(
    join(projectDir, "package.json"),
    JSON.stringify(packageJson, null, 2),
  );

  logger.debug('Created package.json with "type": "module"');
}

export async function createTypeScriptConfig(projectDir: string): Promise<void> {
  const fs = createFileSystem();
  const tsConfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      jsx: "react-jsx",
      skipLibCheck: true,
      esModuleInterop: true,
      paths: { "@/*": ["./*"] },
    },
    include: ["**/*.ts", "**/*.tsx"],
    exclude: ["node_modules"],
  };

  await fs.writeTextFile(
    join(projectDir, "tsconfig.json"),
    `${JSON.stringify(tsConfig, null, 2)}\n`,
  );
}
