import { rendererLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import { createError, toError } from "#veryfront/errors";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { getReactUrls } from "#veryfront/transforms/esm/react-cdn.ts";
import {
  REACT_VERSION_17,
  REACT_VERSION_18_2,
  REACT_VERSION_19,
} from "#veryfront/utils/constants/cdn.ts";

export type ReactVersion = "17" | "18" | "19";

export interface ReactVersionConfig {
  version: ReactVersion;
  exact: string;
  imports: Record<string, string>;
}

interface ReactVersionSwitcher {
  switchTo(version: ReactVersion): Promise<void>;
  getCurrentVersion(): Promise<ReactVersion | null>;
  getAvailableVersions(): ReactVersion[];
}

export const REACT_CONFIGS: Record<ReactVersion, ReactVersionConfig> = {
  "17": {
    version: "17",
    exact: REACT_VERSION_17,
    imports: getReactUrls(REACT_VERSION_17),
  },
  "18": {
    version: "18",
    exact: REACT_VERSION_18_2,
    imports: getReactUrls(REACT_VERSION_18_2),
  },
  "19": {
    version: "19",
    exact: REACT_VERSION_19,
    imports: getReactUrls(REACT_VERSION_19),
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getImportMap(
  value: unknown,
  source: string,
): Record<string, string> {
  if (value === undefined) return {};
  if (
    !isRecord(value) ||
    Object.values(value).some((specifier) => typeof specifier !== "string")
  ) {
    throw new TypeError(`${source} imports must be an object with string values`);
  }
  return value as Record<string, string>;
}

function getReactConfig(version: ReactVersion): ReactVersionConfig {
  const config = REACT_CONFIGS[version];
  if (config) return config;

  throw toError(
    createError({
      type: "config",
      message: `Unsupported React version: ${version}`,
    }),
  );
}

export async function generateReactVersionConfig(
  projectDir: string,
  targetVersion: ReactVersion,
  options: { extends?: string; additional?: Record<string, unknown> } = {},
): Promise<void> {
  const config = getReactConfig(targetVersion);

  const fs = createFileSystem();
  const baseConfigPath = join(projectDir, options.extends ?? "deno.json");

  let baseConfig: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await fs.readTextFile(baseConfigPath));
    if (!isRecord(parsed)) {
      throw new TypeError(`Base config at ${baseConfigPath} must contain a JSON object`);
    }
    baseConfig = parsed;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    logger.warn(`Base config not found at ${baseConfigPath}; generating without it`);
  }

  const baseImports = getImportMap(baseConfig.imports, `Base config at ${baseConfigPath}`);
  const additionalImports = getImportMap(
    options.additional?.imports,
    "Additional config",
  );

  const versionConfig = {
    ...baseConfig,
    imports: {
      ...baseImports,
      ...additionalImports,
      ...config.imports,
    },
  };

  const configPath = join(projectDir, `deno.react${targetVersion}.json`);
  await fs.writeTextFile(configPath, JSON.stringify(versionConfig, null, 2));

  logger.info(`Generated React ${targetVersion} configuration at ${configPath}`);
}

export async function generateAllReactConfigs(projectDir: string): Promise<void> {
  await Promise.all(
    (Object.keys(REACT_CONFIGS) as ReactVersion[]).map((version) =>
      generateReactVersionConfig(projectDir, version)
    ),
  );
}

export function getReactImports(version: ReactVersion): Record<string, string> {
  return getReactConfig(version).imports;
}

export async function detectReactVersionFromConfig(
  projectDir: string,
): Promise<ReactVersion | null> {
  const fs = createFileSystem();
  const configPath = join(projectDir, "deno.json");

  try {
    const parsed: unknown = JSON.parse(await fs.readTextFile(configPath));
    if (!isRecord(parsed)) {
      throw new TypeError(`React config at ${configPath} must contain a JSON object`);
    }
    const reactImport = getImportMap(
      parsed.imports,
      `React config at ${configPath}`,
    ).react;
    if (!reactImport) return null;

    const match = /(?:^|[/:])react@(\d+)(?=$|[.\-+/?#&:])/u.exec(reactImport);
    const major = match?.[1];
    return major === "17" || major === "18" || major === "19" ? major : null;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export function createReactVersionSwitcher(
  projectDir: string,
): ReactVersionSwitcher {
  return {
    async switchTo(version: ReactVersion): Promise<void> {
      const fs = createFileSystem();
      const configPath = join(projectDir, `deno.react${version}.json`);

      if (!(await fs.exists(configPath))) {
        await generateReactVersionConfig(projectDir, version);
      }

      logger.info(`Switched to React ${version} configuration`);
      logger.info(
        `Use --config deno.react${version}.json to run with React ${version}`,
      );
    },

    getCurrentVersion(): Promise<ReactVersion | null> {
      return detectReactVersionFromConfig(projectDir);
    },

    getAvailableVersions(): ReactVersion[] {
      return Object.keys(REACT_CONFIGS) as ReactVersion[];
    },
  };
}
