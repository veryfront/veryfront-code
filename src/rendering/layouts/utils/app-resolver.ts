import { isAbsolute, join, normalize, relative } from "#veryfront/compat/path";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { rendererLogger } from "#veryfront/utils";
import { CONFIG_INVALID } from "#veryfront/errors";

const logger = rendererLogger.component("app-resolver");

const VALID_EXTENSIONS = ["tsx", "jsx", "ts", "js", "mdx", "md"];

function isValidComponentPath(path: string): boolean {
  if (path.includes("\0")) return false;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return VALID_EXTENSIONS.includes(ext);
}

export async function resolveAppComponentPath(
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
): Promise<string | null> {
  logger.debug("Starting app component resolution", { hasConfig: !!config });

  const configApp = config?.app;

  if (configApp === false) {
    logger.debug("App component disabled via config.app: false");
    return null;
  }

  if (configApp) {
    if (!isValidComponentPath(configApp)) {
      throw CONFIG_INVALID.create({
        detail:
          `Invalid app component path: "${configApp}". Check your veryfront.config.ts 'app' setting.`,
      });
    }

    const appPath = isAbsolute(configApp) ? normalize(configApp) : join(projectDir, configApp);
    if (!isPathWithinRoot(appPath, projectDir)) {
      throw CONFIG_INVALID.create({
        detail: "Configured app component path must stay inside the project",
      });
    }

    if (!(await adapter.fs.exists(appPath))) {
      throw CONFIG_INVALID.create({
        detail: `Configured app component does not exist: "${configApp}"`,
      });
    }

    const stat = adapter.fs.lstat
      ? await adapter.fs.lstat(appPath)
      : await adapter.fs.stat(appPath);
    if (!stat.isFile || stat.isSymlink) {
      throw CONFIG_INVALID.create({
        detail: "Configured app component must be a regular file",
      });
    }

    if (adapter.fs.realPath) {
      const [canonicalPath, canonicalRoot] = await Promise.all([
        adapter.fs.realPath(appPath),
        adapter.fs.realPath(projectDir),
      ]);
      if (!isPathWithinRoot(canonicalPath, canonicalRoot)) {
        throw CONFIG_INVALID.create({
          detail: "Configured app component path must stay inside the project",
        });
      }
    }

    logger.debug("Using configured app component");
    return appPath;
  }

  for (const ext of VALID_EXTENSIONS) {
    const appPath = join(projectDir, `components/app.${ext}`);
    const exists = await adapter.fs.exists(appPath);
    logger.debug("Checked default app component path", { exists });

    if (!exists) continue;

    logger.debug("Found app component via discovery");
    return appPath;
  }

  logger.debug("No app component found");
  return null;
}

function isPathWithinRoot(path: string, root: string): boolean {
  const relativePath = relative(normalize(root), normalize(path));
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}
