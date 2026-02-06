import { rendererLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getReactUrls } from "#veryfront/transforms/esm/package-registry.ts";
import {
  REACT_VERSION_17,
  REACT_VERSION_18_2,
  REACT_VERSION_19_RC,
} from "#veryfront/utils/constants/cdn.ts";

export type ReactVersion = "17" | "18" | "19";

export interface ReactVersionConfig {
  version: ReactVersion;
  exact: string;
  imports: Record<string, string>;
}

export interface ReactVersionSwitcher {
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
    exact: REACT_VERSION_19_RC,
    imports: getReactUrls(REACT_VERSION_19_RC),
  },
};

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
    baseConfig = JSON.parse(await fs.readTextFile(baseConfigPath));
  } catch (error) {
    logger.warn(`Could not read base config from ${baseConfigPath}`, error);
  }

  const baseImports = (baseConfig.imports as Record<string, string> | undefined) ?? {};
  const additionalImports = (options.additional?.imports as Record<string, string> | undefined) ??
    {};

  const versionConfig = {
    ...baseConfig,
    imports: {
      ...baseImports,
      ...config.imports,
      ...additionalImports,
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
    const config = JSON.parse(await fs.readTextFile(configPath)) as {
      imports?: { react?: string };
    };

    const reactImport = config.imports?.react;
    if (!reactImport) return null;

    for (const [version, versionConfig] of Object.entries(REACT_CONFIGS)) {
      if (reactImport.includes(`@${versionConfig.exact}`)) {
        return version as ReactVersion;
      }
    }

    if (reactImport.includes("@17")) return "17";
    if (reactImport.includes("@18")) return "18";
    if (reactImport.includes("@19")) return "19";

    return null;
  } catch (error) {
    logger.error("Failed to detect React version from config", error);
    return null;
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
