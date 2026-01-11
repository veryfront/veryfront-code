import { rendererLogger as logger } from "@veryfront/utils";
import { join } from "@veryfront/platform/compat/path/index.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";

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
    exact: "17.0.2",
    imports: {
      react: "https://esm.sh/react@17.0.2",
      "react-dom": "https://esm.sh/react-dom@17.0.2",
      "react-dom/server": "https://esm.sh/react-dom@17.0.2/server",
      "react/jsx-runtime": "https://esm.sh/react@17.0.2/jsx-runtime",
      "react/jsx-dev-runtime": "https://esm.sh/react@17.0.2/jsx-dev-runtime",
    },
  },
  "18": {
    version: "18",
    exact: "18.2.0",
    imports: {
      react: "https://esm.sh/react@18.2.0",
      "react-dom": "https://esm.sh/react-dom@18.2.0",
      "react-dom/server": "https://esm.sh/react-dom@18.2.0/server",
      "react-dom/client": "https://esm.sh/react-dom@18.2.0/client",
      "react/jsx-runtime": "https://esm.sh/react@18.2.0/jsx-runtime",
      "react/jsx-dev-runtime": "https://esm.sh/react@18.2.0/jsx-dev-runtime",
    },
  },
  "19": {
    version: "19",
    exact: "19.0.0-rc.0",
    imports: {
      react: "https://esm.sh/react@19.0.0-rc.0",
      "react-dom": "https://esm.sh/react-dom@19.0.0-rc.0",
      "react-dom/server": "https://esm.sh/react-dom@19.0.0-rc.0/server",
      "react-dom/client": "https://esm.sh/react-dom@19.0.0-rc.0/client",
      "react/jsx-runtime": "https://esm.sh/react@19.0.0-rc.0/jsx-runtime",
      "react/jsx-dev-runtime": "https://esm.sh/react@19.0.0-rc.0/jsx-dev-runtime",
    },
  },
};

export async function generateReactVersionConfig(
  projectDir: string,
  targetVersion: ReactVersion,
  options: { extends?: string; additional?: Record<string, unknown> } = {},
): Promise<void> {
  const config = REACT_CONFIGS[targetVersion];
  if (!config) {
    throw toError(createError({
      type: "config",
      message: `Unsupported React version: ${targetVersion}`,
    }));
  }

  const fs = createFileSystem();
  const baseConfigPath = join(projectDir, options.extends || "deno.json");
  let baseConfig: Record<string, unknown> = {};

  try {
    const baseConfigText = await fs.readTextFile(baseConfigPath);
    baseConfig = JSON.parse(baseConfigText);
  } catch (_error) {
    logger.warn(`Could not read base config from ${baseConfigPath}`, _error);
  }

  const versionConfig = {
    ...baseConfig,
    imports: {
      ...(baseConfig.imports ?? {}),
      ...(config.imports ?? {}),
      ...(options.additional?.imports ?? {}),
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

export function getReactImports(version: ReactVersion) {
  const config = REACT_CONFIGS[version];
  if (!config) {
    throw toError(createError({
      type: "config",
      message: `Unsupported React version: ${version}`,
    }));
  }
  return config.imports;
}

export async function detectReactVersionFromConfig(
  projectDir: string,
): Promise<ReactVersion | null> {
  try {
    const fs = createFileSystem();
    const configPath = join(projectDir, "deno.json");
    const configText = await fs.readTextFile(configPath);
    const config = JSON.parse(configText);

    const reactImport = config.imports?.react;

    if (!reactImport) {
      return null;
    }

    for (const [version, versionConfig] of Object.entries(REACT_CONFIGS)) {
      if (reactImport.includes(`@${versionConfig.exact}`)) {
        return version as ReactVersion;
      }
    }

    if (reactImport.includes("@17")) return "17";
    if (reactImport.includes("@18")) return "18";
    if (reactImport.includes("@19")) return "19";

    return null;
  } catch (_error) {
    logger.error("Failed to detect React version from config", _error);
    return null;
  }
}

export function createReactVersionSwitcher(projectDir: string): ReactVersionSwitcher {
  return {
    async switchTo(version: ReactVersion): Promise<void> {
      const fs = createFileSystem();
      const configPath = join(projectDir, `deno.react${version}.json`);
      const exists = await fs.exists(configPath);
      if (!exists) {
        await generateReactVersionConfig(projectDir, version);
      }

      logger.info(`Switched to React ${version} configuration`);
      logger.info(`Use --config deno.react${version}.json to run with React ${version}`);
    },

    getCurrentVersion(): Promise<ReactVersion | null> {
      return detectReactVersionFromConfig(projectDir);
    },

    getAvailableVersions(): ReactVersion[] {
      return Object.keys(REACT_CONFIGS) as ReactVersion[];
    },
  };
}
