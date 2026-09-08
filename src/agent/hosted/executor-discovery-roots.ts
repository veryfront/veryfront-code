import { isAbsolute, relative, resolve, sep } from "node:path";
import type { VeryfrontConfig } from "#veryfront/config";
import { createProjectDiscoveryConfig } from "#veryfront/discovery/project-discovery-config.ts";
import { ExecutorDiscoveryError } from "#veryfront/agent/hosted/executor-discovery-schema.ts";

/** @internal Bind every enabled discovery root to the canonical immutable source. */
export async function bindExecutorDiscoveryRoots(
  projectDir: string,
  config: VeryfrontConfig,
  canonicalize: (path: string) => Promise<string>,
) {
  const localConfig: VeryfrontConfig = { ...config, fs: { type: "local" } };
  const discovery = createProjectDiscoveryConfig({ projectDir, config: localConfig });
  const ai = { ...localConfig.ai };
  for (
    const [kind, directories] of [
      ["tools", discovery.toolDirs],
      ["agents", discovery.agentDirs],
      ["skills", discovery.skillDirs],
      ["resources", discovery.resourceDirs],
      ["prompts", discovery.promptDirs],
      ["workflows", discovery.workflowDirs],
      ["tasks", discovery.taskDirs],
      ["schedules", discovery.scheduleDirs],
      ["webhooks", discovery.webhookDirs],
      ["evals", discovery.evalDirs],
    ] as const
  ) {
    const paths: string[] = [];
    for (const directory of directories) {
      let canonical: string;
      try {
        canonical = await canonicalize(resolve(projectDir, directory));
      } catch (error) {
        if (
          error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT"
        ) continue;
        throw error;
      }
      const local = relative(projectDir, canonical);
      if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
        throw new ExecutorDiscoveryError("CONFIG_INVALID");
      }
      paths.push(local || ".");
    }
    ai[kind] = { ...ai[kind], discovery: { ...ai[kind]?.discovery, paths } };
  }
  return { ...localConfig, ai };
}
