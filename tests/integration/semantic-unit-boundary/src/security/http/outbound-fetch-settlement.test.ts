import { assertEquals } from "#veryfront/testing/assert.ts";

const REPOSITORY_ROOT = new URL("../../../../../../", import.meta.url);
const OUTBOUND_FETCH_MODULE = new URL("src/security/http/outbound-fetch.ts", REPOSITORY_ROOT);
const TESTING_MODULE = new URL("src/testing/index.ts", REPOSITORY_ROOT);
const ASSERT_MODULE = new URL("src/testing/assert.ts", REPOSITORY_ROOT);
const CHILD_TIMEOUT_MS = 10_000;

function childScript(hookName: "object" | "response"): string {
  return `
import { assertEquals, assertRejects } from ${JSON.stringify(ASSERT_MODULE.href)};
import { withEnv } from ${JSON.stringify(TESTING_MODULE.href)};
import {
  __runWithOutboundFetchTransportForTests,
  createVeryfrontApiDownloadOutboundFetch,
  HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV,
  OutboundRequestBlockedError,
} from ${JSON.stringify(OUTBOUND_FETCH_MODULE.href)};

const { createServer } = await import("node:net");
const hookPrototype = ${JSON.stringify(hookName)} === "response"
  ? Response.prototype
  : Object.prototype;
let releaseResponse!: () => void;
let notifyRequest!: () => void;
const requestStarted = new Promise<void>((resolve) => {
  notifyRequest = resolve;
});
const sockets = new Set<import("node:net").Socket>();
const server = createServer((socket) => {
  sockets.add(socket);
  socket.once("data", (data) => {
    assertEquals(data.toString().includes("Bearer synthetic-token"), true);
    releaseResponse = () =>
      socket.end(
        "HTTP/1.1 200 OK\\r\\nContent-Type: application/octet-stream\\r\\nContent-Length: 21\\r\\nConnection: close\\r\\n\\r\\nauthenticated content",
      );
    notifyRequest();
  });
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Missing socket address");
const origin = \`http://127.0.0.1:\${address.port}\`;
const original = Object.getOwnPropertyDescriptor(hookPrototype, "then");
let leaked = false;
try {
  await withEnv(
    { [HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV]: origin },
    () =>
      __runWithOutboundFetchTransportForTests({
        fetch: () => {
          throw new Error("Authenticated download used unsealed native fetch");
        },
        resolveHost: () => Promise.resolve(["127.0.0.1"]),
      }, async () => {
        const download = createVeryfrontApiDownloadOutboundFetch(origin);
        const response = download(\`\${origin}/file\`, {
          headers: { Authorization: "Bearer synthetic-token" },
        });
        const rejected = assertRejects(() => response, OutboundRequestBlockedError);
        await Promise.race([
          requestStarted,
          response.then(() => {
            throw new Error("Transport settled before the server replied");
          }),
        ]);
        Object.defineProperty(hookPrototype, "then", {
          configurable: true,
          get() {
            if (this instanceof Response) {
              leaked = true;
              void this.clone().text();
            }
            return undefined;
          },
        });
        releaseResponse();
        await rejected;
      }, { allowedResolvedAddresses: ["127.0.0.1"] }),
  );
} finally {
  if (original) Object.defineProperty(hookPrototype, "then", original);
  else Reflect.deleteProperty(hookPrototype, "then");
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
}
assertEquals(leaked, false);
`;
}

async function runSettlementHookRegression(hookName: "object" | "response"): Promise<void> {
  const scriptPath = await Deno.makeTempFile({ suffix: ".ts" });
  await Deno.writeTextFile(scriptPath, childScript(hookName));
  try {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config=deno.json",
        "--no-check",
        `--allow-read=${new URL(".", REPOSITORY_ROOT).pathname},${scriptPath}`,
        "--allow-env=DENO_TESTING,VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS",
        "--allow-net=127.0.0.1",
        scriptPath,
      ],
      cwd: new URL(".", REPOSITORY_ROOT).pathname,
      env: { DENO_TESTING: "1" },
      stdout: "piped",
      stderr: "piped",
    });
    const child = command.spawn();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CHILD_TIMEOUT_MS);
    const [status, stdout, stderr] = await Promise.all([
      child.status,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    clearTimeout(timeout);
    assertEquals(
      status.success,
      true,
      [
        `${hookName} settlement hook subprocess failed`,
        `timed out: ${timedOut}`,
        `stdout: ${stdout}`,
        `stderr: ${stderr}`,
      ].join("\n"),
    );
  } finally {
    await Deno.remove(scriptPath).catch(() => undefined);
  }
}

Deno.test("authenticated download seals native socket responses before a mid-flight Response.prototype then getter", async () => {
  await runSettlementHookRegression("response");
});

Deno.test("authenticated download seals native socket responses before a mid-flight Object.prototype then getter", async () => {
  await runSettlementHookRegression("object");
});
