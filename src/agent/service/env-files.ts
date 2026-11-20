import { cwd as getCwd } from "#veryfront/platform/compat/process.ts";
import { loadWithProvenance } from "#veryfront/platform/compat/std/dotenv.ts";
import { applyVeryfrontApiKeyAlias, startEnvFileLoad } from "#veryfront/utils/env-loader.ts";

const DEFAULT_AGENT_SERVICE_ENV_FILES = [".env", ".env.local"] as const;

/** Result returned from agent service env file load. */
export type AgentServiceEnvFileLoadResult = {
  loadedFiles: string[];
  loadedVariables: number;
};

/** Options accepted by agent service env file load. */
export type AgentServiceEnvFileLoadOptions = {
  cwd?: string;
  files?: readonly string[];
};

/** Result returned from hosted agent service env file load. */
export type HostedAgentServiceEnvFileLoadResult = AgentServiceEnvFileLoadResult;
/** Options accepted by hosted agent service env file load. */
export type HostedAgentServiceEnvFileLoadOptions = AgentServiceEnvFileLoadOptions;

function joinEnvPath(cwd: string, file: string): string {
  if (file.startsWith("/") || file.startsWith("./") || file.startsWith("../")) {
    return file;
  }

  return `${cwd.replace(/\/$/, "")}/${file}`;
}

/**
 * Loads agent service env files.
 *
 * Entries go through the env loader's writer: a value defined before the load
 * wins (an empty one too), in any letter case on Windows, and each written
 * value carries its file provenance and expansion taint. `VERYFRONT_API_KEY`
 * then fills the token slot by the env loader's rule, so a credential from
 * these files is judged the same whichever name holds it.
 */
export async function loadAgentServiceEnvFiles(
  options: AgentServiceEnvFileLoadOptions = {},
): Promise<AgentServiceEnvFileLoadResult> {
  const cwd = options.cwd ?? getCwd();
  const files = options.files ?? DEFAULT_AGENT_SERVICE_ENV_FILES;
  const writeEntry = startEnvFileLoad({ override: false, keepDefined: true });
  const loadedFiles: string[] = [];
  let loadedVariables = 0;

  for (const file of files) {
    const envPath = joinEnvPath(cwd, file);
    const { values, expandedFromProcessEnv } = await loadWithProvenance({ envPath });
    const entries = Object.entries(values);

    if (entries.length === 0) {
      continue;
    }

    loadedFiles.push(envPath);

    for (const [key, value] of entries) {
      if (writeEntry(key, value, envPath, expandedFromProcessEnv.has(key))) loadedVariables++;
    }
  }

  applyVeryfrontApiKeyAlias();
  return { loadedFiles, loadedVariables };
}

/** Loads hosted agent service env files. */
export const loadHostedAgentServiceEnvFiles = loadAgentServiceEnvFiles;
