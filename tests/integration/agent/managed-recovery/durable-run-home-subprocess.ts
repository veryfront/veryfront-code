// Real process fixture: killed only by its owning test after durable boundary acknowledgement.
import "#veryfront/schemas/_test-setup.ts";
import { DurableRunHome } from "#veryfront/internal-agents/durable-run-home.ts";
const [directory, boundary] = Deno.args;
if (!directory || !boundary) throw new Error("Missing subprocess fixture arguments");
const identity = {
  projectId: "11111111-1111-4111-8111-111111111111",
  canonicalRunId: "22222222-2222-4222-8222-222222222222",
  publicRunId: "run-proof",
  sourceHash: "a".repeat(64),
};
const home = await DurableRunHome.open({ directory, identity });
if (boundary === "writer-A" || boundary === "writer-B" || boundary === "writer-same") {
  await home.append({ sequence: 1, value: boundary });
  Deno.exit(0);
}
if (boundary === "committed") {
  await home.append({ sequence: 1, value: { kind: "effect-result", receipt: "synthetic-1" } });
} else if (boundary === "pending") {
  const file = await Deno.open(`${directory}/.pending-crash-fixture`, {
    write: true,
    createNew: true,
  });
  try {
    await file.write(new TextEncoder().encode('{"incomplete":'));
    await file.sync();
  } finally {
    file.close();
  }
} else throw new Error("Unknown subprocess fixture boundary");
await Deno.stdout.write(new TextEncoder().encode("READY\n"));
await new Promise(() => setInterval(() => {}, 1000));
