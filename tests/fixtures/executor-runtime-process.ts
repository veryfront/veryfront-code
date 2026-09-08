import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import { readFileSync } from "node:fs";
import process from "node:process";
import { register } from "#veryfront/extensions/contracts.ts";
import { EsbuildBundler, EsModuleLexer } from "../../extensions/ext-bundler-esbuild/src/index.ts";
import { startExecutorRuntimeEntrypoint } from "#veryfront/agent/hosted/executor-runtime-entrypoint.ts";

register("Bundler", new EsbuildBundler());
register("ModuleLexer", new EsModuleLexer());

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
