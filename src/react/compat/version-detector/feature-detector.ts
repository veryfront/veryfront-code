import { rendererLogger as logger } from "@veryfront/utils";
import * as React from "react";
import type { ReactFeatures, ReactVersionInfo } from "./types.ts";
import { isReact17, isReact18, isReact19, parseVersion } from "./version-parser.ts";

export function detectFeatures(
  major: number,
  minor: number,
  isReact19Flag: boolean,
): ReactFeatures {
  return {
    suspense: major >= 18,
    streaming: major >= 18,
    automaticBatching: major >= 18,
    transitions: major >= 18,
    serverComponents: major >= 18 && minor >= 3,

    useFormStatus: isReact19Flag,
    useOptimistic: isReact19Flag,
    serverActions: isReact19Flag,
    improvedSuspense: isReact19Flag,
    enhancedStreaming: isReact19Flag,

    renderToString: true,
    renderToStaticMarkup: true,
    renderToNodeStream: true,
    renderToPipeableStream: major >= 18,
    renderToReadableStream: major >= 18,
  };
}

export function detectReactVersion(): ReactVersionInfo {
  const version = React.version;
  const { major, minor, patch } = parseVersion(version);

  const react17 = isReact17(major);
  const react18 = isReact18(major);
  const react19 = isReact19(major, version);

  const features = detectFeatures(major, minor, react19);

  const info: ReactVersionInfo = {
    version,
    major,
    minor,
    patch,
    isReact17: react17,
    isReact18: react18,
    isReact19: react19,
    features,
  };

  logger.debug("Detected React version", info);

  return info;
}

/**
 * Detect React version from a specific project directory.
 * This is used for multi-tenant rendering where each project
 * may have a different React version installed.
 */
export async function detectReactVersionFromProject(projectDir: string): Promise<ReactVersionInfo> {
  let version: string;

  try {
    // Try to read React version from project's package.json dependencies
    const packageJsonPath = `${projectDir}/package.json`;
    const packageJson = JSON.parse(await Deno.readTextFile(packageJsonPath));
    const reactDep = packageJson.dependencies?.react ||
      packageJson.devDependencies?.react ||
      packageJson.peerDependencies?.react;

    if (reactDep) {
      // Strip version prefixes like ^, ~, >= etc
      version = reactDep.replace(/^[\^~>=<]+/, "");
      logger.debug("Detected React version from package.json", { projectDir, version });
    } else {
      // Fallback to bundled React version
      version = React.version;
      logger.debug("No React in package.json, using bundled version", { projectDir, version });
    }
  } catch {
    // If package.json doesn't exist or can't be read, use bundled React
    version = React.version;
    logger.debug("Could not read package.json, using bundled React version", {
      projectDir,
      version,
    });
  }

  const { major, minor, patch } = parseVersion(version);

  const react17 = isReact17(major);
  const react18 = isReact18(major);
  const react19 = isReact19(major, version);

  const features = detectFeatures(major, minor, react19);

  const info: ReactVersionInfo = {
    version,
    major,
    minor,
    patch,
    isReact17: react17,
    isReact18: react18,
    isReact19: react19,
    features,
  };

  logger.debug("Detected React version for project", { projectDir, ...info });

  return info;
}
