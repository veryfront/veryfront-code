import { join } from "#veryfront/compat/path/index.ts";
import { CONFIG_INVALID, CONFIG_PARSE_ERROR } from "#veryfront/errors";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import * as React from "react";
import type { ReactFeatures, ReactVersionInfo } from "./types.ts";
import {
  isReact17,
  isReact18,
  isReact19,
  parseVersion,
  resolveReactDependencyVersion,
} from "./version-parser.ts";

const MAX_PROJECT_PACKAGE_JSON_BYTES = 1_048_576;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const REACT_DEPENDENCY_SCOPES = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function detectFeatures(
  major: number,
  minor: number,
): ReactFeatures {
  const isReact18Plus = major >= 18;
  const hasReact19Features = major >= 19;
  const serverComponents = major > 18 || (major === 18 && minor >= 3);

  return Object.freeze({
    suspense: isReact18Plus,
    streaming: isReact18Plus,
    automaticBatching: isReact18Plus,
    transitions: isReact18Plus,
    serverComponents,

    useFormStatus: hasReact19Features,
    useOptimistic: hasReact19Features,
    serverActions: hasReact19Features,
    improvedSuspense: hasReact19Features,
    enhancedStreaming: hasReact19Features,

    renderToString: true,
    renderToStaticMarkup: true,
    renderToNodeStream: major < 19,
    renderToPipeableStream: isReact18Plus,
    renderToReadableStream: isReact18Plus,
  });
}

function buildVersionInfo(version: string): ReactVersionInfo {
  const { major, minor, patch } = parseVersion(version);
  const react19 = isReact19(major, version);

  return Object.freeze({
    version,
    major,
    minor,
    patch,
    isReact17: isReact17(major),
    isReact18: isReact18(major),
    isReact19: react19,
    features: detectFeatures(major, minor),
  });
}

export function detectReactVersion(): ReactVersionInfo {
  const info = buildVersionInfo(React.version);
  logger.debug("Detected React version", info);
  return info;
}

export async function detectReactVersionFromProject(
  projectDir: string,
): Promise<ReactVersionInfo> {
  const packageJsonPath = join(projectDir, "package.json");
  const fs = createFileSystem();
  let packageJsonBytes: Uint8Array;
  try {
    const packageJsonInfo = await fs.stat(packageJsonPath);
    if (!packageJsonInfo.isFile) {
      throw CONFIG_INVALID.create({
        detail: "Project package.json must be a regular file",
      });
    }
    if (packageJsonInfo.size > MAX_PROJECT_PACKAGE_JSON_BYTES) {
      throw CONFIG_INVALID.create({
        detail: "Project package.json exceeds the 1 MiB limit",
      });
    }
    packageJsonBytes = await fs.readFile(packageJsonPath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;

    const info = buildVersionInfo(React.version);
    logger.debug("Project package.json not found; using bundled React version", info);
    return info;
  }

  if (packageJsonBytes.byteLength > MAX_PROJECT_PACKAGE_JSON_BYTES) {
    throw CONFIG_INVALID.create({
      detail: "Project package.json exceeds the 1 MiB limit",
    });
  }

  let packageJsonText: string;
  try {
    packageJsonText = UTF8_DECODER.decode(packageJsonBytes);
  } catch (cause) {
    throw CONFIG_PARSE_ERROR.create({
      detail: "Project package.json must use valid UTF-8",
      cause,
    });
  }

  let packageJson: unknown;
  try {
    packageJson = JSON.parse(packageJsonText);
  } catch (cause) {
    throw CONFIG_PARSE_ERROR.create({
      detail: "Project package.json must contain valid JSON",
      cause,
    });
  }

  if (!isRecord(packageJson)) {
    throw CONFIG_INVALID.create({
      detail: "Project package.json must contain a JSON object",
    });
  }

  let dependencySpecifier: string | undefined;
  let dependencyScope: typeof REACT_DEPENDENCY_SCOPES[number] | undefined;
  for (const scope of REACT_DEPENDENCY_SCOPES) {
    const dependencies = packageJson[scope];
    if (dependencies === undefined) continue;
    if (!isRecord(dependencies)) {
      throw CONFIG_INVALID.create({
        detail: `Project package.json field "${scope}" must contain a JSON object`,
      });
    }
    if (!Object.hasOwn(dependencies, "react")) continue;

    const candidate = dependencies.react;
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      throw CONFIG_INVALID.create({
        detail: `React dependency in "${scope}" must be a non-empty string`,
      });
    }
    dependencySpecifier = candidate;
    dependencyScope = scope;
    break;
  }

  if (dependencySpecifier === undefined) {
    const info = buildVersionInfo(React.version);
    logger.debug("No React dependency declared; using bundled React version", info);
    return info;
  }

  const version = resolveReactDependencyVersion(dependencySpecifier);
  const info = buildVersionInfo(version);
  logger.debug("Detected React version from project package.json", {
    dependencyScope,
    ...info,
  });
  return info;
}
