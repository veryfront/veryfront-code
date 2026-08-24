import { isAbsolute, join, normalize } from "#veryfront/compat/path";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { rendererLogger } from "#veryfront/utils";
import { CONFIG_INVALID } from "#veryfront/errors";
import { isPathContainedBy } from "#veryfront/platform/adapters/path-containment.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";

const logger = rendererLogger.component("app-resolver");

const VALID_EXTENSIONS = ["tsx", "jsx", "ts", "js", "mdx", "md"];

function isValidComponentPath(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".") + 1);
  return VALID_EXTENSIONS.includes(ext);
}

async function assertCanonicalContainment(
  path: string,
  projectRoot: string,
  displayPath: string,
  adapter: RuntimeAdapter,
): Promise<void> {
  const realPath = adapter.fs.realPath;
  if (!realPath) return;

  let canonicalRoot: string;
  let canonicalPath: string;
  try {
    [canonicalRoot, canonicalPath] = await Promise.all([
      realPath.call(adapter.fs, projectRoot),
      realPath.call(adapter.fs, path),
    ]);
  } catch (error) {
    if (!isCanonicalNotFoundError(error)) throw error;
    throw CONFIG_INVALID.create({
      detail:
        `Configured app component does not exist: "${displayPath}". Check your veryfront.config.ts 'app' setting.`,
    });
  }

  if (!isPathContainedBy(canonicalPath, canonicalRoot)) {
    throw CONFIG_INVALID.create({
      detail:
        `Configured app component resolves outside the project directory: "${displayPath}". Check your veryfront.config.ts 'app' setting.`,
    });
  }
}

export async function resolveAppComponentPath(
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
): Promise<string | null> {
  logger.debug("Starting resolution", {
    projectDir,
    hasAdapter: !!adapter,
    hasConfig: !!config,
    configApp: config?.app,
  });

  const configApp = config?.app;

  if (configApp === false) {
    logger.debug("App component disabled via config.app: false");
    return null;
  }

  if (configApp) {
    const displayPath = isAbsolute(configApp) ? "<absolute path>" : configApp;
    if (!isValidComponentPath(configApp)) {
      throw CONFIG_INVALID.create({
        detail:
          `Invalid app component path: "${displayPath}". Check your veryfront.config.ts 'app' setting.`,
      });
    }

    const projectRoot = normalize(projectDir);
    const appPath = isAbsolute(configApp)
      ? normalize(configApp)
      : normalize(join(projectRoot, configApp));

    if (!isPathContainedBy(appPath, projectRoot)) {
      throw CONFIG_INVALID.create({
        detail:
          `Configured app component must stay inside the project directory: "${displayPath}". Check your veryfront.config.ts 'app' setting.`,
      });
    }

    if (!(await adapter.fs.exists(appPath))) {
      throw CONFIG_INVALID.create({
        detail:
          `Configured app component does not exist: "${displayPath}". Check your veryfront.config.ts 'app' setting.`,
      });
    }
    await assertCanonicalContainment(appPath, projectRoot, displayPath, adapter);

    logger.debug("Using config.app", { path: appPath });
    return appPath;
  }

  for (const ext of VALID_EXTENSIONS) {
    const appPath = join(projectDir, `components/app.${ext}`);
    const exists = await adapter.fs.exists(appPath);
    logger.debug("Checking default path", { appPath, exists });

    if (!exists) continue;

    await assertCanonicalContainment(
      appPath,
      normalize(projectDir),
      `components/app.${ext}`,
      adapter,
    );

    logger.debug("Found app component via discovery", { path: appPath });
    return appPath;
  }

  logger.debug("No app component found");
  return null;
}
