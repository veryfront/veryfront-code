import { readFileSync } from "node:fs";
import process from "node:process";
import {
  initializeExecutorRuntimeContracts,
  startExecutorRuntimeEntrypoint,
} from "veryfront/agent/executor-runtime";

await initializeExecutorRuntimeContracts();
const executor = await startExecutorRuntimeEntrypoint({
  mode: process.argv[3] === "project-tools" ? "project-tools" : "runtime",
  readKey: () => Promise.resolve(new Uint8Array(readFileSync(0))),
  readArtifact: () =>
    Promise.resolve({
      manifest: {
        version: 1,
        root: "project",
        owner: { scopeKind: "global", serviceName: "synthetic-broker" },
        source: { type: "release", releaseId: "synthetic-release" },
      },
      projectDir: process.argv[2],
    }),
});
process.stdout.write(`${JSON.stringify({ pid: process.pid, port: executor.address.port })}\n`);
try {
  const channel = await executor.ready;
  await channel.closed;
} finally {
  await executor.close();
}
