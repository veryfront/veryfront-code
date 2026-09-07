import "#veryfront/schemas/_test-setup.ts";
import { Buffer } from "node:buffer";
import { pbkdf2 } from "node:crypto";
import process from "node:process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHostedExecutorAllocatorClient } from "#veryfront/agent/hosted/executor-allocator-client.ts";

const requestData = {
  allocationId: "00000000-0000-4000-8000-000000000001",
  invocationId: "00000000-0000-4000-8000-000000000002",
  owner: { scopeKind: "project" as const, projectId: "project-1" },
  source: { type: "release" as const, releaseId: "release-1" },
  requestedAt: 1000,
  prepareDeadlineAt: 2000,
  hardDeadlineAt: 3000,
};
const view = {
  binding: {
    allocationId: requestData.allocationId,
    invocationId: requestData.invocationId,
    owner: requestData.owner,
    source: requestData.source,
    brokerInstanceId: "00000000-0000-4000-8000-000000000003",
    generation: 1,
  },
  phase: "preparing" as const,
  expiresAt: 2000,
};
const signal = () => new AbortController().signal;

function certificate() {
  const directory = mkdtempSync(join(tmpdir(), "executor-https-fixture-"));
  const config = join(directory, "openssl.cnf");
  const certPath = join(directory, "certificate.pem");
  const keyPath = join(directory, "key.pem");
  try {
    writeFileSync(
      config,
      "[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=localhost\n[v3]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n",
      { mode: 0o600 },
    );
    execFileSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-config",
      config,
    ], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
    const cert = readFileSync(certPath, "utf8");
    const key = readFileSync(keyPath, "utf8");
    assert(cert && key, "Local TLS fixture is incomplete");
    return { cert, key };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

if ("Deno" in globalThis || "Bun" in globalThis) {
  it("runs allocator HTTPS integration on Node", { timeout: 30_000 }, async () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const child = spawn("node", [
      "--import",
      "./tests/node/resolver.mjs",
      "--test",
      fileURLToPath(import.meta.url),
    ], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => output += chunk);
    child.stderr.on("data", (chunk) => output += chunk);
    const timeout = setTimeout(() => child.kill(), 25_000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      assertEquals(code, 0, output);
    } finally {
      clearTimeout(timeout);
      child.kill();
    }
  });
} else {
  const tls = certificate();
  describe("executor allocator HTTPS client", () => {
    it("retains allocator DNS work until the native lookup settles", async () => {
      if (process.env.VF_EXECUTOR_DNS_RETIREMENT_TEST === "1") {
        let nativeWorkDone = false;
        const busy = new Promise<void>((resolve, reject) => {
          pbkdf2("synthetic", "synthetic", 700_000, 32, "sha256", (error) => {
            nativeWorkDone = true;
            if (error) reject(error);
            else resolve();
          });
        });
        const client = createHostedExecutorAllocatorClient({
          baseUrl: "https://localhost:1",
          timeoutMs: 10,
          readBrokerToken: () => Promise.resolve("synthetic-token"),
        });
        try {
          await assertRejects(() => client.observe(view.binding, signal()));
          assertEquals(
            nativeWorkDone,
            true,
            "The queued DNS lookup must retire before client work settles",
          );
        } finally {
          await busy;
        }
        return;
      }
      const child = spawn(process.execPath, [
        ...(process.sourceMapsEnabled ? ["--enable-source-maps"] : []),
        "--import",
        "./tests/node/resolver.mjs",
        "--test",
        "--test-name-pattern=retains allocator DNS",
        fileURLToPath(import.meta.url),
      ], {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: {
          PATH: process.env.PATH,
          UV_THREADPOOL_SIZE: "1",
          VF_EXECUTOR_DNS_RETIREMENT_TEST: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => output += chunk);
      child.stderr.on("data", (chunk) => output += chunk);
      const timer = setTimeout(() => child.kill(), 10_000);
      try {
        assertEquals(
          await new Promise<number | null>((resolve, reject) => {
            child.once("error", reject);
            child.once("close", resolve);
          }),
          0,
          output,
        );
      } finally {
        clearTimeout(timer);
        child.kill();
      }
    });

    it("snapshots allocation data before token I/O and uses rotated broker tokens", async () => {
      const calls: { url?: string; authorization?: string; body: unknown }[] = [];
      const server = createServer(tls, async (request, response) => {
        calls.push({
          url: request.url,
          authorization: request.headers.authorization,
          body: await body(request),
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(view));
      });
      const token = Promise.withResolvers<string>();
      let reads = 0;
      const client = createHostedExecutorAllocatorClient({
        baseUrl: await listen(server),
        ca: tls.cert,
        readBrokerToken: () => ++reads === 1 ? token.promise : Promise.resolve("synthetic-rotated"),
      });
      const key = new Uint8Array(32).fill(42);
      const original = structuredClone(requestData);
      try {
        const pending = client.allocate(original, { channelKey: key }, signal());
        key.fill(0);
        original.source.releaseId = "changed";
        original.owner.projectId = "changed-project";
        token.resolve("synthetic-initial");
        assertEquals(await pending, view);
        assertEquals(await client.observe(view.binding, signal()), view);
        assertEquals(calls, [{
          url: "/agent-executors/allocate",
          authorization: "Bearer synthetic-initial",
          body: { request: requestData, channelKey: Buffer.alloc(32, 42).toString("base64") },
        }, {
          url: "/agent-executors/observe",
          authorization: "Bearer synthetic-rotated",
          body: { binding: view.binding },
        }]);
      } finally {
        await close(server);
      }
    });

    for (
      const owner of [
        { scopeKind: "global" as const, serviceName: "@example/agent" },
        { scopeKind: "project" as const, projectId: "synthetic-project" },
      ]
    ) {
      it(`preserves exact ${owner.scopeKind} owner through every allocator operation`, async () => {
        const allocationRequest = { ...requestData, owner };
        const binding = { ...view.binding, owner };
        const calls: { url?: string; body: unknown }[] = [];
        const server = createServer(tls, async (request, response) => {
          calls.push({ url: request.url, body: await body(request) });
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ ...view, binding }));
        });
        const client = createHostedExecutorAllocatorClient({
          baseUrl: await listen(server),
          ca: tls.cert,
          readBrokerToken: () => Promise.resolve("synthetic-token"),
        });
        const key = new Uint8Array(32).fill(42);
        try {
          await client.allocate(allocationRequest, { channelKey: key }, signal());
          await client.observe(binding, signal());
          await client.renew(binding, signal());
          await client.release(binding, "completed", signal());
          assertEquals(calls, [
            {
              url: "/agent-executors/allocate",
              body: {
                request: allocationRequest,
                channelKey: Buffer.alloc(32, 42).toString("base64"),
              },
            },
            { url: "/agent-executors/observe", body: { binding } },
            { url: "/agent-executors/renew", body: { binding } },
            { url: "/agent-executors/release", body: { binding, reason: "completed" } },
          ]);
        } finally {
          key.fill(0);
          await close(server);
        }
      });
    }

    it("rejects untrusted TLS and never follows redirects or replays failed POSTs", async () => {
      let requests = 0;
      const server = createServer(tls, (_request, response) => {
        requests++;
        response.writeHead(307, { location: "https://127.0.0.1:1/other" });
        response.end();
      });
      const baseUrl = await listen(server);
      try {
        const untrusted = createHostedExecutorAllocatorClient({
          baseUrl,
          readBrokerToken: () => Promise.resolve("synthetic-token"),
        });
        await assertRejects(() => untrusted.observe(view.binding, signal()));
        assertEquals(requests, 0);
        const trusted = createHostedExecutorAllocatorClient({
          baseUrl,
          ca: tls.cert,
          readBrokerToken: () => Promise.resolve("synthetic-token"),
        });
        await assertRejects(() => trusted.observe(view.binding, signal()));
        assertEquals(requests, 1);
      } finally {
        await close(server);
      }
    });

    for (
      const invalid of ["oversized", "malformed", "content-type", "truncated", "status"] as const
    ) {
      it(`rejects ${invalid} responses with fixed diagnostics`, async () => {
        const server = createServer(tls, (_request, response) => {
          response.writeHead(invalid === "status" ? 503 : 200, {
            "content-type": invalid === "content-type" ? "text/plain" : "application/json",
          });
          if (invalid === "truncated") {
            response.write('{"secret":');
            response.destroy();
          } else {response.end(
              invalid === "oversized"
                ? JSON.stringify("x".repeat(32_769))
                : "synthetic-private-diagnostic",
            );}
        });
        const client = createHostedExecutorAllocatorClient({
          baseUrl: await listen(server),
          ca: tls.cert,
          readBrokerToken: () => Promise.resolve("synthetic-token"),
        });
        try {
          const error = await assertRejects(() => client.observe(view.binding, signal()));
          assertEquals(String(error).includes("synthetic-private-diagnostic"), false);
          assertEquals(String(error).includes("synthetic-token"), false);
        } finally {
          await close(server);
        }
      });
    }

    it("cancels stalled I/O and does not send after a late token read", async () => {
      const entered = Promise.withResolvers<void>();
      const server = createServer(tls, () => entered.resolve());
      const baseUrl = await listen(server);
      try {
        const controller = new AbortController();
        const client = createHostedExecutorAllocatorClient({
          baseUrl,
          ca: tls.cert,
          timeoutMs: 1000,
          readBrokerToken: () => Promise.resolve("synthetic-token"),
        });
        const pending = client.observe(view.binding, controller.signal);
        const rejected = assertRejects(() => pending);
        await entered.promise;
        controller.abort();
        await rejected;
        const token = Promise.withResolvers<string>();
        const late = new AbortController();
        const delayed = createHostedExecutorAllocatorClient({
          baseUrl,
          ca: tls.cert,
          readBrokerToken: () => token.promise,
        });
        const lateCall = delayed.observe(view.binding, late.signal);
        late.abort();
        token.resolve("synthetic-token");
        await assertRejects(() => lateCall);
      } finally {
        await close(server);
      }
    });

    it("requires a fixed HTTPS origin and rejects invalid credentials before sending", async () => {
      for (
        const baseUrl of [
          "http://localhost",
          "https://u:p@localhost",
          "https://localhost/path",
          "https://localhost/?query=1",
        ]
      ) {
        assertThrows(() =>
          createHostedExecutorAllocatorClient({
            baseUrl,
            readBrokerToken: () => Promise.resolve("synthetic"),
          })
        );
      }
      let received = 0;
      const server = createServer(tls, (_request, response: ServerResponse) => {
        received++;
        response.end();
      });
      const client = createHostedExecutorAllocatorClient({
        baseUrl: await listen(server),
        ca: tls.cert,
        readBrokerToken: () => Promise.resolve("bad\nheader"),
      });
      try {
        await assertRejects(() => client.observe(view.binding, signal()));
        assertEquals(received, 0);
      } finally {
        await close(server);
      }
    });
  });
}
