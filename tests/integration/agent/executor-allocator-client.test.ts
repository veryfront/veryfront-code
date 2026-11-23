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
    it("accepts native Node with a Deno compatibility namespace", () => {
      const original = Object.getOwnPropertyDescriptor(globalThis, "Deno");
      Object.defineProperty(globalThis, "Deno", {
        configurable: true,
        value: { version: { deno: "compatibility" } },
      });
      try {
        const client = createHostedExecutorAllocatorClient({
          baseUrl: "https://allocator.example.test",
          readBrokerToken: () => Promise.resolve("synthetic-token"),
        });
        assertEquals(typeof client.allocate, "function");
      } finally {
        if (original) Object.defineProperty(globalThis, "Deno", original);
        else Reflect.deleteProperty(globalThis, "Deno");
      }
    });
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
      const calls: {
        url?: string;
        authorization?: string;
        projectSelector?: unknown;
        body: unknown;
      }[] = [];
      const server = createServer(tls, async (request, response) => {
        calls.push({
          url: request.url,
          authorization: request.headers.authorization,
          projectSelector: request.headers["x-veryfront-executor-project"],
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
          projectSelector: requestData.owner.projectId,
          body: { request: requestData, channelKey: Buffer.alloc(32, 42).toString("base64") },
        }, {
          url: "/agent-executors/observe",
          authorization: "Bearer synthetic-rotated",
          projectSelector: requestData.owner.projectId,
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
        const calls: { url?: string; projectSelector?: unknown; body: unknown }[] = [];
        const server = createServer(tls, async (request, response) => {
          calls.push({
            url: request.url,
            projectSelector: request.headers["x-veryfront-executor-project"],
            body: await body(request),
          });
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
              projectSelector: owner.scopeKind === "project" ? owner.projectId : undefined,
              body: {
                request: allocationRequest,
                channelKey: Buffer.alloc(32, 42).toString("base64"),
              },
            },
            {
              url: "/agent-executors/observe",
              projectSelector: owner.scopeKind === "project" ? owner.projectId : undefined,
              body: { binding },
            },
            {
              url: "/agent-executors/renew",
              projectSelector: owner.scopeKind === "project" ? owner.projectId : undefined,
              body: { binding },
            },
            {
              url: "/agent-executors/release",
              projectSelector: owner.scopeKind === "project" ? owner.projectId : undefined,
              body: { binding, reason: "completed" },
            },
          ]);
        } finally {
          key.fill(0);
          await close(server);
        }
      });
    }

    it("keeps concurrent project selectors with their captured allocation bodies", async () => {
      const calls: { selector: unknown; owner: unknown }[] = [];
      const server = createServer(tls, async (request, response) => {
        const value = await body(request);
        calls.push({
          selector: request.headers["x-veryfront-executor-project"],
          owner: value.request.owner,
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          ...view,
          binding: {
            ...view.binding,
            allocationId: value.request.allocationId,
            invocationId: value.request.invocationId,
            owner: value.request.owner,
          },
        }));
      });
      const token = Promise.withResolvers<string>();
      let reads = 0;
      const client = createHostedExecutorAllocatorClient({
        baseUrl: await listen(server),
        ca: tls.cert,
        readBrokerToken: () => ++reads === 1 ? token.promise : Promise.resolve("synthetic"),
      });
      const original = {
        ...structuredClone(requestData),
        owner: { scopeKind: "project" as const, projectId: "project-a" },
      };
      const key = new Uint8Array(32).fill(42);
      const pending: Promise<unknown>[] = [];
      try {
        pending.push(client.allocate(original, { channelKey: key }, signal()));
        pending.push(
          client.allocate(
            {
              ...requestData,
              allocationId: "00000000-0000-4000-8000-000000000004",
              invocationId: "00000000-0000-4000-8000-000000000005",
              owner: { scopeKind: "project", projectId: "project-b" },
            },
            { channelKey: key },
            signal(),
          ),
        );
        original.owner.projectId = "mutated";
        await pending[1];
        token.resolve("synthetic");
        await pending[0];
        assertEquals(calls, [
          { selector: "project-b", owner: { scopeKind: "project", projectId: "project-b" } },
          { selector: "project-a", owner: { scopeKind: "project", projectId: "project-a" } },
        ]);
      } finally {
        key.fill(0);
        token.resolve("synthetic");
        await Promise.allSettled(pending);
        await close(server);
      }
    });

    for (const operation of ["observe", "renew", "release"] as const) {
      it(`snapshots the ${operation} selector before token I/O`, async () => {
        const calls: { selector: unknown; owner: unknown }[] = [];
        const server = createServer(tls, async (request, response) => {
          calls.push({
            selector: request.headers["x-veryfront-executor-project"],
            owner: (await body(request)).binding.owner,
          });
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(view));
        });
        const token = Promise.withResolvers<string>();
        const client = createHostedExecutorAllocatorClient({
          baseUrl: await listen(server),
          ca: tls.cert,
          readBrokerToken: () => token.promise,
        });
        const binding = structuredClone(view.binding);
        const pending = operation === "release"
          ? client.release(binding, "completed", signal())
          : client[operation](binding, signal());
        try {
          binding.owner.projectId = "mutated";
          token.resolve("synthetic");
          await pending;
          assertEquals(calls, [{ selector: "project-1", owner: requestData.owner }]);
        } finally {
          token.resolve("synthetic");
          await Promise.allSettled([pending]);
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
