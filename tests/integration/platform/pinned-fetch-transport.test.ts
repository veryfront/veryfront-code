import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun, isNode } from "#veryfront/platform/compat/runtime.ts";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { fetchWithPinnedAddresses } from "#veryfront/platform/compat/http/pinned-fetch.ts";

describe("pinned fetch transport integration", () => {
  for (const responseStarted of [false, true]) {
    it(`closes native transport when late abort reason throws after ${responseStarted ? "response" : "request"} creation`, async () => {
      const { createServer } = await import("node:net");
      let markRequestSeen!: () => void;
      const requestSeen = new Promise<void>((resolve) => {
        markRequestSeen = resolve;
      });
      let markClosed!: () => void;
      const closed = new Promise<boolean>((resolve) => {
        markClosed = () => resolve(true);
      });
      let peer: import("node:net").Socket | undefined;
      const server = createServer((socket) => {
        peer = socket;
        socket.once("close", markClosed);
        socket.once("data", () => {
          if (responseStarted) {
            socket.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nfirst\r\n");
          }
          markRequestSeen();
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing TCP address");
        const abort = new AbortController();
        const reasonError = new Error("abort reason getter failed");
        Object.defineProperty(abort.signal, "reason", {
          get() {
            throw reasonError;
          },
        });
        const pending = fetchWithPinnedAddresses(
          new URL(`http://pinned-throwing-abort.test:${address.port}/`),
          ["127.0.0.1"],
          { signal: abort.signal, headers: { authorization: "Bearer vf-late-abort-test" } },
        ).then((response) => response, (error: unknown) => error);
        await requestSeen;
        if (responseStarted) {
          const response = await pending;
          if (!(response instanceof Response)) throw new Error("Expected streaming response");
          const reader = response.body!.getReader();
          await reader.read();
          const read = reader.read().then(() => "resolved", () => "rejected");
          abort.abort();
          const transportClosed = await Promise.race([
            closed,
            new Promise<boolean>((resolve) => {
              timeout = setTimeout(() => resolve(false), 500);
            }),
          ]);
          assertEquals(transportClosed, true);
          assertEquals(await read, "rejected");
        } else {
          abort.abort();
          assertEquals(await pending, reasonError);
          const transportClosed = await Promise.race([
            closed,
            new Promise<boolean>((resolve) => {
              timeout = setTimeout(() => resolve(false), 500);
            }),
          ]);
          assertEquals(transportClosed, true);
        }
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        peer?.destroy();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
    });
  }

  it("keeps Node transport imports lazy for constrained runtimes", async () => {
    const source = await readFile(
      new URL("../../../src/platform/compat/http/pinned-fetch.ts", import.meta.url),
      "utf8",
    );
    const eagerNodeImport = source.split("\n").find((line) =>
      /^import\s+(?!type\b).*from\s+["']node:/.test(line.trim())
    );
    assertEquals(eagerNodeImport, undefined);
  });

  it("captures Node transport before sibling imports can patch request members", () => {
    if (!isNode) return;

    const script = `
      let patchedSetHeaderSawBearer = false;

      import { fetchWithPinnedAddresses } from "./src/platform/compat/http/pinned-fetch.ts";
      import "data:text/javascript,import { ClientRequest } from 'node:http'; const originalSetHeader = ClientRequest.prototype.setHeader; ClientRequest.prototype.setHeader = function(name, value) { if (String(name).toLowerCase() === 'authorization' && value === 'Bearer vf-sibling-import-secret') globalThis.patchedSetHeaderSawBearer = true; return Reflect.apply(originalSetHeader, this, [name, value]); };";

      globalThis.patchedSetHeaderSawBearer = false;
      const outcome = await fetchWithPinnedAddresses(
        new URL("http://pinned-sibling-import.test:1/"),
        ["127.0.0.1"],
        { headers: { authorization: "Bearer vf-sibling-import-secret" } },
      ).then(
        () => "resolved",
        (error) => error instanceof Error ? error.message : String(error),
      );
      console.log(JSON.stringify({
        patchedSetHeaderSawBearer: globalThis.patchedSetHeaderSawBearer,
        refused: outcome.includes("Refused a credential-bearing request"),
      }));
    `;

    const output = spawnSync("node", [
      "--import",
      "./tests/node/resolver.mjs",
      "--input-type=module",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.stderr, "");
    assertEquals(output.status, 0);
    assertEquals(JSON.parse(output.stdout), {
      patchedSetHeaderSawBearer: false,
      refused: true,
    });
  });

  it("cleans up abort listeners when the Node request constructor rejects before assignment", () => {
    if (!isNode) return;

    const script = `
      import { fetchWithPinnedAddresses } from "./src/platform/compat/http/pinned-fetch.ts";
      const abort = new AbortController();
      await fetchWithPinnedAddresses(
        new URL("http://pinned-invalid-method.test/"),
        ["127.0.0.1"],
        { method: "BAD METHOD", signal: abort.signal },
      ).then(
        () => { throw new Error("invalid method unexpectedly succeeded"); },
        (error) => {
          if (!(error instanceof TypeError)) throw error;
        },
      );
      abort.abort(new DOMException("stop", "AbortError"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      console.log("abort-after-constructor-failure-survived");
    `;

    const output = spawnSync("node", [
      "--import",
      "./tests/node/resolver.mjs",
      "--input-type=module",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.stdout.trim(), "abort-after-constructor-failure-survived");
    assertEquals(output.stderr, "");
    assertEquals(output.status, 0);
  });

  it("cleans up abort listeners when an integrity check refuses before request creation", () => {
    const script = `
      import { getEventListeners } from "node:events";
      import { ClientRequest } from "node:http";
      import { fetchWithPinnedAddresses } from "./src/platform/compat/http/pinned-fetch.ts";

      const abort = new AbortController();
      const originalSetHeader = Object.getOwnPropertyDescriptor(ClientRequest.prototype, "setHeader");
      Object.defineProperty(ClientRequest.prototype, "setHeader", {
        configurable: true,
        writable: true,
        value() {},
      });
      try {
        const outcome = await fetchWithPinnedAddresses(
          new URL("http://pinned-integrity-listener.test/"),
          ["127.0.0.1"],
          { headers: { authorization: "Bearer vf-integrity-listener" }, signal: abort.signal },
        ).then(
          () => "resolved",
          (error) => error instanceof Error ? error.message : String(error),
        );
        console.log(JSON.stringify({
          refused: outcome.includes("Refused a credential-bearing request"),
          abortListeners: getEventListeners(abort.signal, "abort").length,
        }));
      } finally {
        if (originalSetHeader) {
          Object.defineProperty(ClientRequest.prototype, "setHeader", originalSetHeader);
        } else Reflect.deleteProperty(ClientRequest.prototype, "setHeader");
      }
    `;

    const output = spawnSync("node", [
      "--import",
      "./tests/node/resolver.mjs",
      "--input-type=module",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.stderr, "");
    assertEquals(output.status, 0);
    assertEquals(JSON.parse(output.stdout), {
      refused: true,
      abortListeners: 0,
    });
  });

  it("captures Deno node transport before later project patches", () => {
    const script = `
      import { createServer, ClientRequest } from "node:http";
      import { fetchWithPinnedAddresses } from "./src/platform/compat/http/pinned-fetch.ts";

      const bearer = "Bearer vf-deno-first-use-secret";
      const originalEnd = ClientRequest.prototype.end;
      let patchedEndWasCalled = false;
      let patchedEndSawBearer = false;
      let receivedAuthorization = null;
      const server = createServer((request, response) => {
        receivedAuthorization = request.headers.authorization ?? null;
        request.resume();
        response.end("ok");
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });

      try {
        ClientRequest.prototype.end = function(...args) {
          patchedEndWasCalled = true;
          patchedEndSawBearer = this.getHeader("authorization") === bearer;
          return Reflect.apply(originalEnd, this, args);
        };

        const address = server.address();
        const outcome = await fetchWithPinnedAddresses(
          new URL("http://pinned-deno-first-use.test:" + address.port + "/resource"),
          ["127.0.0.1"],
          { headers: { authorization: bearer } },
        ).then(
          () => "resolved",
          (error) => error instanceof Error ? error.message : String(error),
        );

        console.log(JSON.stringify({
          patchedEndSawBearer,
          patchedEndWasCalled,
          receivedAuthorization,
          refused: outcome.includes("Refused a credential-bearing request"),
        }));
      } finally {
        ClientRequest.prototype.end = originalEnd;
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
      }
    `;

    const output = spawnSync("deno", [
      "eval",
      "--config=deno.json",
      "--quiet",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.stderr, "");
    assertEquals(output.status, 0);
    assertEquals(JSON.parse(output.stdout), {
      patchedEndSawBearer: false,
      patchedEndWasCalled: false,
      receivedAuthorization: null,
      refused: true,
    });
  });

  it("does not construct a Node request after synchronous abort registration", () => {
    const script = `
      import nodeHttp from "node:http";
      import { syncBuiltinESMExports } from "node:module";

      const originalRequest = nodeHttp.request;
      let requestCalls = 0;
      nodeHttp.request = function(...args) {
        requestCalls++;
        return Reflect.apply(originalRequest, this, args);
      };
      syncBuiltinESMExports();

      const { fetchWithPinnedAddresses } = await import("./src/platform/compat/http/pinned-fetch.ts");
      const abortReason = new DOMException("sync stop", "AbortError");
      let cleanupCalls = 0;
      const synchronousSignal = {
        aborted: false,
        reason: abortReason,
        addEventListener(_event, listener) {
          listener();
        },
        removeEventListener() {
          cleanupCalls++;
        },
      };

      const outcome = await fetchWithPinnedAddresses(
        new URL("http://pinned-sync-abort.test/"),
        ["127.0.0.1"],
        {
          headers: { authorization: "Bearer vf-sync-abort-secret" },
          signal: synchronousSignal,
        },
      ).then(
        () => "resolved",
        (error) => error instanceof Error ? error.name + ":" + error.message : String(error),
      );

      nodeHttp.request = originalRequest;
      syncBuiltinESMExports();
      console.log(JSON.stringify({ cleanupCalls, outcome, requestCalls }));
    `;

    const output = spawnSync("node", [
      "--import",
      "./tests/node/resolver.mjs",
      "--input-type=module",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.stderr, "");
    assertEquals(output.status, 0);
    assertEquals(JSON.parse(output.stdout), {
      cleanupCalls: 1,
      outcome: "AbortError:sync stop",
      requestCalls: 0,
    });
  });

  it("keeps a patched array iterator from seeing private agents during socket locking", () => {
    const script = `
      const bearer = "Bearer vf-array-iterator-agent-secret";
      const originalIterator = Array.prototype[Symbol.iterator];
      let leakedAgent;
      Array.prototype[Symbol.iterator] = function() {
        for (let index = 0; index < this.length; index++) {
          const value = this[index];
          if (value?.target?.sockets && value?.target?.requests) leakedAgent = value.target;
        }
        return Reflect.apply(originalIterator, this, []);
      };

      const { fetchWithPinnedAddresses } = await import("./src/platform/compat/http/pinned-fetch.ts");
      await fetchWithPinnedAddresses(
        new URL("http://pinned-array-iterator.test:9/resource"),
        ["127.0.0.1"],
        { headers: { authorization: bearer } },
      ).catch(() => undefined);
      Array.prototype[Symbol.iterator] = originalIterator;
      const sockets = leakedAgent
        ? Object.values(leakedAgent.sockets).flatMap((value) => Array.isArray(value) ? value : [])
        : [];
      const observedAuthorization = sockets.some((socket) =>
        socket?._httpMessage?.getHeader?.("authorization") === bearer
      );
      console.log(JSON.stringify({ leakedAgent: Boolean(leakedAgent), observedAuthorization }));
    `;

    const output = spawnSync("node", [
      "--import",
      "./tests/node/resolver.mjs",
      "--input-type=module",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.stderr, "");
    assertEquals(output.status, 0);
    assertEquals(JSON.parse(output.stdout), {
      leakedAgent: false,
      observedAuthorization: false,
    });
  });

  it("re-attests before piping a decoded response", () => {
    const script = `
      import { createServer, IncomingMessage } from "node:http";
      import { gzipSync } from "node:zlib";
      import { fetchWithPinnedAddresses } from "./src/platform/compat/http/pinned-fetch.ts";

      let observedAuthorization;
      const originalHeadersGet = Headers.prototype.get;
      let pipeOwner = IncomingMessage.prototype;
      let originalPipe = Object.getOwnPropertyDescriptor(pipeOwner, "pipe");
      while (originalPipe?.value === undefined && Object.getPrototypeOf(pipeOwner)) {
        pipeOwner = Object.getPrototypeOf(pipeOwner);
        originalPipe = Object.getOwnPropertyDescriptor(pipeOwner, "pipe");
      }
      if (originalPipe?.value === undefined) throw new Error("missing IncomingMessage pipe");
      const server = createServer((_request, response) => {
        const body = gzipSync(Buffer.from("decoded-body"));
        response.writeHead(200, {
          "content-encoding": "gzip",
          "content-length": String(body.byteLength),
        });
        response.end(body);
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });

      Headers.prototype.get = function(name) {
        const value = Reflect.apply(originalHeadersGet, this, [name]);
        if (String(name).toLowerCase() === "content-encoding" && value) {
          Object.defineProperty(pipeOwner, "pipe", {
            configurable: true,
            writable: true,
            ...originalPipe,
            value(...args) {
              observedAuthorization ??= this.req?.getHeader?.("authorization");
              return Reflect.apply(originalPipe.value, this, args);
            },
          });
        }
        return value;
      };

      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("missing server address");
        const outcome = await fetchWithPinnedAddresses(
          new URL(\`http://pinned-decoder.test:\${address.port}/resource\`),
          ["127.0.0.1"],
          { headers: { authorization: "Bearer vf-decoder-pipe" } },
        ).then(
          async (response) => \`resolved:\${await response.text()}\`,
          (error) => error instanceof Error ? error.message : String(error),
        );
        console.log(JSON.stringify({
          refused: outcome.includes("Refused a credential-bearing request"),
          observedAuthorization: observedAuthorization ?? null,
        }));
      } finally {
        Headers.prototype.get = originalHeadersGet;
        Object.defineProperty(pipeOwner, "pipe", originalPipe);
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
      }
    `;

    const output = spawnSync("node", [
      "--import",
      "./tests/node/resolver.mjs",
      "--input-type=module",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.stderr, "");
    assertEquals(output.status, 0);
    assertEquals(JSON.parse(output.stdout), {
      refused: true,
      observedAuthorization: null,
    });
  });

  it("closes the socket when an integrity refusal interrupts a stream write", () => {
    const script = `
      import nodeHttp from "node:http";
      import nodeNet from "node:net";
      import { syncBuiltinESMExports } from "node:module";

      let socket;
      const originalCreateConnection = nodeNet.createConnection;
      nodeNet.createConnection = () => {
        socket = new nodeNet.Socket();
        socket.connecting = true;
        return socket;
      };
      syncBuiltinESMExports();

      const { fetchWithPinnedAddresses } = await import("./src/platform/compat/http/pinned-fetch.ts");
      let controller;
      const body = new ReadableStream({
        start(value) {
          controller = value;
          value.enqueue(new TextEncoder().encode("first"));
        },
      });
      const pending = fetchWithPinnedAddresses(
        new URL("http://pinned-integrity-close.test/upload"),
        ["127.0.0.1"],
        { method: "POST", headers: { authorization: "Bearer vf-integrity-close" }, body },
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      const originalWrite = Object.getOwnPropertyDescriptor(nodeHttp.ClientRequest.prototype, "write");
      Object.defineProperty(nodeHttp.ClientRequest.prototype, "write", {
        configurable: true,
        writable: true,
        value() {
          throw new Error("patched write should not run");
        },
      });
      controller.enqueue(new TextEncoder().encode("second"));
      const outcome = await pending.then(
        () => "resolved",
        (error) => error instanceof Error ? error.message : String(error),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (originalWrite) {
        Object.defineProperty(nodeHttp.ClientRequest.prototype, "write", originalWrite);
      } else Reflect.deleteProperty(nodeHttp.ClientRequest.prototype, "write");
      nodeNet.createConnection = originalCreateConnection;
      syncBuiltinESMExports();
      console.log(JSON.stringify({
        outcome,
        requestDestroyed: socket?._httpMessage?.destroyed === true,
        socketDestroyed: socket?.destroyed === true,
      }));
    `;

    const output = spawnSync("node", [
      "--import",
      "./tests/node/resolver.mjs",
      "--input-type=module",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.stderr, "");
    assertEquals(output.status, 0);
    const result = JSON.parse(output.stdout) as {
      outcome: string;
      requestDestroyed: boolean;
      socketDestroyed: boolean;
    };
    assertEquals(result.outcome.includes("Refused a credential-bearing request"), true);
    assertEquals(result.requestDestroyed, true);
    assertEquals(result.socketDestroyed, true);
  });

  it("keeps socket prototype patches after transport load from seeing the bearer", () => {
    const script = `
      import * as nodeHttp from "node:http";
      import * as nodeNet from "node:net";
      import { EventEmitter } from "node:events";
      import { fetchWithPinnedAddresses } from "./src/platform/compat/http/pinned-fetch.ts";

      const bearer = "Bearer vf-node-after-assignment-secret";
      let patchArmed = false;
      const originalWrite = Object.getOwnPropertyDescriptor(nodeNet.Socket.prototype, "write");
      const inheritedWrite = nodeNet.Socket.prototype.write;
      const originalEmit = Object.getOwnPropertyDescriptor(EventEmitter.prototype, "emit");
      const originalConnect = Object.getOwnPropertyDescriptor(nodeNet.Socket.prototype, "connect");
      let writeSawBearer = false;
      let emitSawBearer = false;
      Object.defineProperty(nodeNet.Socket.prototype, "connect", {
        configurable: true,
        writable: true,
        ...originalConnect,
        value(...args) {
          const result = Reflect.apply(originalConnect.value, this, args);
          if (!patchArmed) {
            patchArmed = true;
            queueMicrotask(() => {
              Object.defineProperty(nodeNet.Socket.prototype, "write", {
                configurable: true,
                writable: true,
                ...originalWrite,
                value(chunk, ...writeArgs) {
                  const text = typeof chunk === "string"
                    ? chunk
                    : Buffer.isBuffer(chunk)
                    ? chunk.toString("latin1")
                    : "";
                  if (text.includes("vf-node-after-assignment-secret")) writeSawBearer = true;
                  return Reflect.apply(inheritedWrite, this, [chunk, ...writeArgs]);
                },
              });
              Object.defineProperty(EventEmitter.prototype, "emit", {
                configurable: true,
                writable: true,
                ...originalEmit,
                value(name, ...emitArgs) {
                  const value = this?._httpMessage?.getHeader?.("authorization");
                  if (value === bearer) emitSawBearer = true;
                  return Reflect.apply(originalEmit.value, this, [name, ...emitArgs]);
                },
              });
            });
          }
          return result;
        },
      });

      let receivedAuthorization;
      const server = nodeHttp.createServer((request, response) => {
        receivedAuthorization = request.headers.authorization;
        request.resume();
        response.writeHead(204);
        response.end();
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });

      const address = server.address();
      const response = fetchWithPinnedAddresses(
        new URL("http://pinned-delayed-socket.test:" + address.port + "/resource"),
        ["127.0.0.1"],
        { headers: { authorization: bearer } },
      );
      const status = await response.then(
        (result) => result.status,
        (error) => error instanceof Error ? error.message : String(error),
      );

      if (originalWrite) {
        Object.defineProperty(nodeNet.Socket.prototype, "write", originalWrite);
      } else Reflect.deleteProperty(nodeNet.Socket.prototype, "write");
      Object.defineProperty(EventEmitter.prototype, "emit", originalEmit);
      Object.defineProperty(nodeNet.Socket.prototype, "connect", originalConnect);
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      console.log(JSON.stringify({
        emitSawBearer,
        receivedAuthorization,
        status,
        writeSawBearer,
      }));
    `;

    const output = spawnSync("node", [
      "--import",
      "./tests/node/resolver.mjs",
      "--input-type=module",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.stderr, "");
    assertEquals(output.status, 0);
    assertEquals(JSON.parse(output.stdout), {
      emitSawBearer: false,
      status:
        "Refused a credential-bearing request to protect its token: the node:http member connect was replaced, added or removed after load, and node:http calls it with the request headers in reach. Do not patch node:http, node:net, node:tls, streams or EventEmitter.",
      writeSawBearer: false,
    });
  });

  it("keeps Bun post-assignment socket prototype patches from seeing the bearer", () => {
    const available = spawnSync("bun", ["--version"], { encoding: "utf8" });
    if (available.error || available.status !== 0) return;

    const script = `
      import * as nodeHttp from "node:http";
      import * as nodeNet from "node:net";
      import { EventEmitter } from "node:events";

      const bearer = "Bearer vf-bun-after-assignment-secret";
      let patchArmed = false;
      const originalWrite = Object.getOwnPropertyDescriptor(nodeNet.Socket.prototype, "write");
      const inheritedWrite = nodeNet.Socket.prototype.write;
      const originalEmit = Object.getOwnPropertyDescriptor(EventEmitter.prototype, "emit");
      const originalConnect = Object.getOwnPropertyDescriptor(nodeNet.Socket.prototype, "connect");
      let writeSawBearer = false;
      let emitSawBearer = false;
      Object.defineProperty(nodeNet.Socket.prototype, "connect", {
        configurable: true,
        writable: true,
        ...originalConnect,
        value(...args) {
          const result = Reflect.apply(originalConnect.value, this, args);
          if (!patchArmed) {
            patchArmed = true;
            queueMicrotask(() => {
              Object.defineProperty(nodeNet.Socket.prototype, "write", {
                configurable: true,
                writable: true,
                ...originalWrite,
                value(chunk, ...writeArgs) {
                  const text = typeof chunk === "string"
                    ? chunk
                    : Buffer.isBuffer(chunk)
                    ? chunk.toString("latin1")
                    : "";
                  if (text.includes("vf-bun-after-assignment-secret")) writeSawBearer = true;
                  return Reflect.apply(inheritedWrite, this, [chunk, ...writeArgs]);
                },
              });
              Object.defineProperty(EventEmitter.prototype, "emit", {
                configurable: true,
                writable: true,
                ...originalEmit,
                value(name, ...emitArgs) {
                  const value = this?._httpMessage?.getHeader?.("authorization");
                  if (value === bearer) emitSawBearer = true;
                  return Reflect.apply(originalEmit.value, this, [name, ...emitArgs]);
                },
              });
            });
          }
          return result;
        },
      });

      const { fetchWithPinnedAddresses } = await import("./src/platform/compat/http/pinned-fetch.ts");

      let receivedAuthorization;
      const server = nodeHttp.createServer((request, response) => {
        receivedAuthorization = request.headers.authorization;
        request.resume();
        response.writeHead(204);
        response.end();
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });

      const address = server.address();
      const response = fetchWithPinnedAddresses(
        new URL("http://pinned-bun-socket.test:" + address.port + "/resource"),
        ["127.0.0.1"],
        { headers: { authorization: bearer } },
      );
      const status = await response.then(
        (result) => result.status,
        (error) => error instanceof Error ? error.message : String(error),
      );

      if (originalWrite) {
        Object.defineProperty(nodeNet.Socket.prototype, "write", originalWrite);
      } else Reflect.deleteProperty(nodeNet.Socket.prototype, "write");
      Object.defineProperty(EventEmitter.prototype, "emit", originalEmit);
      Object.defineProperty(nodeNet.Socket.prototype, "connect", originalConnect);
      server.closeAllConnections?.();
      await new Promise((resolve, reject) => {
        server.close((error) =>
          (!error || error.code === "ERR_SERVER_NOT_RUNNING") ? resolve() : reject(error)
        );
      });
      console.log(JSON.stringify({
        emitSawBearer,
        receivedAuthorization,
        status,
        writeSawBearer,
      }));
    `;

    const output = spawnSync("bun", [
      "--no-env-file",
      "--preload",
      "./tests/bun/preload.ts",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.stderr, "");
    assertEquals(output.status, 0);
    assertEquals(JSON.parse(output.stdout), {
      emitSawBearer: false,
      receivedAuthorization: "Bearer vf-bun-after-assignment-secret",
      status: 204,
      writeSawBearer: false,
    });
  });

  it("contains Bun payload stream errors without exposing credentials", () => {
    if (!isBun) return;

    const script = `
      import { fetchWithPinnedAddresses } from "./src/platform/compat/http/pinned-fetch.ts";
      import { createServer } from "node:http";

      let releaseRequest;
      const requestSeen = new Promise((resolve) => {
        releaseRequest = resolve;
      });
      const server = createServer((request, _response) => {
        request.resume();
        releaseRequest();
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });

      const secret = ["bun", "payload", "secret"].join("-");
      const bearer = "Bearer " + secret;
      let bodyController;
      const body = new ReadableStream({
        start(controller) {
          bodyController = controller;
          controller.enqueue(new TextEncoder().encode("prefix"));
        },
      });

      const address = server.address();
      let failureMessage = "";
      const request = fetchWithPinnedAddresses(
        new URL(\`http://pinned-payload.test:\${address.port}/resource\`),
        ["127.0.0.1"],
        { method: "POST", headers: { authorization: bearer }, body },
      ).catch((error) => {
        failureMessage = error instanceof Error ? error.message : String(error);
      });
      await requestSeen;

      bodyController.error(new Error("body failed"));
      await request;
      await new Promise((resolve) => setTimeout(resolve, 20));
      server.closeAllConnections?.();
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (!error || error.code === "ERR_SERVER_NOT_RUNNING") resolve();
          else reject(error);
        });
      });
      console.log(JSON.stringify({ failureMessage }));
    `;

    const output = spawnSync(process.execPath, [
      "--no-env-file",
      "--preload",
      "./tests/bun/preload.ts",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.status, 0);
    assertEquals(output.stderr, "");
    assertEquals(JSON.parse(output.stdout).failureMessage, "body failed");
    assertEquals(output.stdout.includes("Bearer bun-payload-secret"), false);
    assertEquals(output.stdout.includes("bun-payload-secret"), false);
  });

  it("cancels a pending body read when abort closes the request", () => {
    if (!isNode) return;

    const script = `
      import { createServer } from "node:http";
      import { fetchWithPinnedAddresses } from "./src/platform/compat/http/pinned-fetch.ts";
      const server = createServer((request) => request.resume());
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing test TCP address");
        const abort = new AbortController();
        let cancelReason = "";
        let markReadPending;
        const readPending = new Promise((resolve) => { markReadPending = resolve; });
        let markCancelled;
        const cancelled = new Promise((resolve) => { markCancelled = resolve; });
        const body = new ReadableStream({
          pull() {
            markReadPending();
            return new Promise(() => {});
          },
          cancel(reason) {
            cancelReason = reason instanceof Error ? reason.name : String(reason);
            markCancelled();
          },
        }, { highWaterMark: 0 });
        const response = fetchWithPinnedAddresses(
          new URL("http://pinned-abort-pending.test:" + address.port + "/"),
          ["127.0.0.1"],
          { method: "POST", signal: abort.signal, body },
        ).then(
          () => "resolved",
          (error) => error instanceof Error ? error.name + ":" + error.message : String(error),
        );
        await readPending;
        abort.abort(new DOMException("stop", "AbortError"));
        const result = await response;
        await cancelled;
        console.log(JSON.stringify({ result, cancelReason }));
      } finally {
        server.closeAllConnections();
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
    `;

    const output = spawnSync("node", [
      "--import",
      "./tests/node/resolver.mjs",
      "--input-type=module",
      "--eval",
      script,
    ], { encoding: "utf8" });

    assertEquals(output.stderr, "");
    assertEquals(output.status, 0);
    assertEquals(JSON.parse(output.stdout), {
      result: "AbortError:stop",
      cancelReason: "AbortError",
    });
  });
});
