import { cwd as getCwd, env as getProcessEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { load as loadDotenv } from "#veryfront/platform/compat/std/dotenv.ts";

const DEFAULT_HOSTED_AGENT_SERVICE_ENV_FILES = [".env", ".env.local"] as const;

export type HostedAgentServiceEnvFileLoadResult = {
  loadedFiles: string[];
  loadedVariables: number;
};

export type HostedAgentServiceEnvFileLoadOptions = {
  cwd?: string;
  files?: readonly string[];
};

function joinEnvPath(cwd: string, file: string): string {
  if (file.startsWith("/") || file.startsWith("./") || file.startsWith("../")) {
    return file;
  }

  return `${cwd.replace(/\/$/, "")}/${file}`;
}

export async function loadHostedAgentServiceEnvFiles(
  options: HostedAgentServiceEnvFileLoadOptions = {},
): Promise<HostedAgentServiceEnvFileLoadResult> {
  const cwd = options.cwd ?? getCwd();
  const files = options.files ?? DEFAULT_HOSTED_AGENT_SERVICE_ENV_FILES;
  const protectedKeys = new Set(Object.keys(getProcessEnv()));
  const loadedFiles: string[] = [];
  let loadedVariables = 0;

  for (const file of files) {
    const envPath = joinEnvPath(cwd, file);
    const parsed = await loadDotenv({ envPath, allowEmptyValues: true });
    const entries = Object.entries(parsed);

    if (entries.length === 0) {
      continue;
    }

    loadedFiles.push(envPath);

    for (const [key, value] of entries) {
      if (protectedKeys.has(key)) {
        continue;
      }

      setEnv(key, value);
      loadedVariables++;
    }
  }

  return { loadedFiles, loadedVariables };
}
