import { readFileSync } from "node:fs";
import process from "node:process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  initializeExecutorRuntimeContracts,
  startExecutorRuntimeEntrypoint,
} from "#veryfront/agent/hosted/executor-runtime-entrypoint.ts";

await initializeExecutorRuntimeContracts();
const mode = process.argv[3] === "http"
  ? "http"
  : process.argv[3] === "project-tools"
  ? "project-tools"
  : "runtime";

// Synthetic allocation key arrives on a private pipe; no broker environment or
// HTTP data is inherited by this executor process.
const executor = await startExecutorRuntimeEntrypoint({
  mode,
  ...(mode === "http"
    ? {
      async createHttpRuntime({ projectDir }: { projectDir: string }) {
        const module = await import(pathToFileURL(join(projectDir, "http.ts")).href);
        const ended = Promise.withResolvers<void>();
        return {
          handle: module.default,
          close: () => {
            ended.resolve();
            return Promise.resolve();
          },
          settled: ended.promise,
        };
      },
    }
    : {}),
  readKey: () => Promise.resolve(new Uint8Array(readFileSync(0))),
  readArtifact: () =>
    Promise.resolve({
      manifest: {
        version: 1,
        root: "project",
        owner: mode === "http"
          ? { scopeKind: "project", projectId: "synthetic-project" }
          : { scopeKind: "global", serviceName: "veryfront-agent" },
        source: { type: "release", releaseId: "synthetic-release" },
      },
      projectDir: process.argv[2]!,
    }),
});
process.stdout.write(
  `${JSON.stringify({ ready: true, pid: process.pid, port: executor.address.port })}\n`,
);
try {
  const channel = await executor.ready;
  await channel.closed;
} finally {
  await executor.close();
}
