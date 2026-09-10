import { readFileSync } from "node:fs";
import process from "node:process";
import {
  initializeExecutorRuntimeContracts,
  startExecutorRuntimeEntrypoint,
} from "#veryfront/agent/hosted/executor-runtime-entrypoint.ts";

await initializeExecutorRuntimeContracts();

// Synthetic allocation key arrives on a private pipe; no broker environment or
// HTTP data is inherited by this executor process.
const executor = await startExecutorRuntimeEntrypoint({
  readKey: () => Promise.resolve(new Uint8Array(readFileSync(0))),
  readArtifact: () =>
    Promise.resolve({
      manifest: {
        version: 1,
        root: "project",
        owner: { scopeKind: "global", serviceName: "veryfront-agent" },
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
