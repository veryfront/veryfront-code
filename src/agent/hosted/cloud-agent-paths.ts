/** Path and directory resolution utilities for the Veryfront Cloud agent service. */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "#veryfront/platform/compat/path/index.ts";
import { cwd, env } from "#veryfront/platform/compat/process.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { DEFAULT_PROJECT_DISCOVERY_DIRS } from "../../discovery/index.ts";
import type { CreateNodeAgentServiceRuntimeInfrastructureOptions } from "../service/node-runtime-infrastructure.ts";

/** A path option that is either a string path or a URL. */
export type AgentServicePathOption = string | URL;

export const DEFAULT_AGENT_SERVICE_NAME = "veryfront-agent-service";

const PROJECT_CONFIG_FILES = [
  "veryfront.config.js",
  "veryfront.config.ts",
  "veryfront.config.mjs",
];

/** Converts a path option (string or URL) to a string path. */
export function pathOptionToPath(pathOption: AgentServicePathOption): string {
  return pathOption instanceof URL ? fileURLToPath(pathOption) : pathOption;
}

/** Resolves the base directory from baseDir or entrypointUrl options. */
export function resolveBaseDir(
  options: { baseDir?: AgentServicePathOption; entrypointUrl?: AgentServicePathOption },
): string {
  if (options.baseDir !== undefined) {
    return pathOptionToPath(options.baseDir);
  }
  if (options.entrypointUrl !== undefined) {
    return dirname(pathOptionToPath(options.entrypointUrl));
  }
  return cwd();
}

function hasDiscoveryRoot(baseDir: string): boolean {
  const discoveryDirs = [
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.agentDirs,
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.toolDirs,
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.skillDirs,
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.resourceDirs,
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.promptDirs,
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.workflowDirs,
    ...DEFAULT_PROJECT_DISCOVERY_DIRS.taskDirs,
  ];

  return discoveryDirs.some((dir) => existsSync(resolve(baseDir, dir))) ||
    PROJECT_CONFIG_FILES.some((file) => existsSync(resolve(baseDir, file)));
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}

/** Resolves the project directory from options, walking up for a discovery root. */
export function resolveProjectDir(
  options: {
    baseDir?: AgentServicePathOption;
    entrypointUrl?: AgentServicePathOption;
    projectDir?: string;
  },
): string {
  if (options.projectDir) {
    return options.projectDir;
  }

  const baseDir = resolveBaseDir(options);
  const candidates = uniquePaths([baseDir, dirname(baseDir), dirname(dirname(baseDir))]);
  return candidates.find(hasDiscoveryRoot) ?? baseDir;
}

/**
 * Schema for the subset of a project manifest (package.json / deno.json) we
 * read. Only `name` is consumed; extra fields are tolerated via passthrough so
 * arbitrary manifests validate. Defined lazily via `defineSchema` so the zod
 * extension is resolved at call time — the cloud-agent options resolver calls
 * `ensureDefaultSchemaValidator()` before reaching service-name resolution, so
 * a validator is registered by the time this runs.
 */
const getProjectManifestSchema = defineSchema((v) =>
  v.object({
    name: v.string().optional(),
  }).passthrough()
);

/** Reads the `name` field from the nearest package.json or deno.json, or null. */
export function readProjectManifestName(projectDir: string): string | null {
  const manifestSchema = getProjectManifestSchema();

  for (const fileName of ["package.json", "deno.json"]) {
    const filePath = resolve(projectDir, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const result = manifestSchema.safeParse(JSON.parse(readFileSync(filePath, "utf8")));
      if (!result.success) continue;
      const name = result.data.name;
      if (typeof name !== "string") continue;
      const trimmedName = name.trim();
      if (trimmedName) return trimmedName;
    } catch {
      continue;
    }
  }

  return null;
}

type ServiceNameOptions = {
  serviceName?: string;
  baseDir?: AgentServicePathOption;
  entrypointUrl?: AgentServicePathOption;
  projectDir?: string;
  env?: CreateNodeAgentServiceRuntimeInfrastructureOptions["env"];
  processTarget?: { env?: CreateNodeAgentServiceRuntimeInfrastructureOptions["env"] };
};

/** Resolves the service name from options, env, or project manifest. */
export function resolveServiceName(options: ServiceNameOptions): string {
  if (options.serviceName?.trim()) {
    return options.serviceName.trim();
  }

  const resolved = resolveEnvironment(options);
  const envServiceName = resolved?.VERYFRONT_AGENT_SERVICE_NAME?.trim();
  if (envServiceName) {
    return envServiceName;
  }

  return readProjectManifestName(resolveProjectDir(options)) ?? DEFAULT_AGENT_SERVICE_NAME;
}

/** Returns the default process target if `process` is available in the runtime. */
export function resolveDefaultProcessTarget() {
  if (typeof process === "undefined") {
    return undefined;
  }
  return process;
}

/** Resolves the environment record from explicit env, processTarget.env, or the process env. */
export function resolveEnvironment(
  options: {
    env?: CreateNodeAgentServiceRuntimeInfrastructureOptions["env"];
    processTarget?: { env?: CreateNodeAgentServiceRuntimeInfrastructureOptions["env"] };
  },
): CreateNodeAgentServiceRuntimeInfrastructureOptions["env"] {
  if (options.env) {
    return options.env;
  }
  if (options.processTarget?.env) {
    return options.processTarget.env;
  }
  return env();
}
