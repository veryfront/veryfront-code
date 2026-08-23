import { startServer, stopServer } from "../../tests/e2e/setup/server.ts";

try {
  await startServer({ projectSlugs: ["alpha", "beta"] });
  const child = new Deno.Command("node", {
    args: ["scripts/ci/verify-windows-localhost-routing.mjs"],
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await child.status;
  if (!status.success) {
    throw new Error(`Windows localhost routing verifier exited with code ${status.code}`);
  }
} finally {
  await stopServer();
}
