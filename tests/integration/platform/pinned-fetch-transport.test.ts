import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun, isNode } from "#veryfront/platform/compat/runtime.ts";
import { spawnSync } from "node:child_process";
import process from "node:process";

describe("pinned fetch transport integration", () => {
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

    const output = spawnSync(process.execPath, [
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

  it("keeps post-assignment socket prototype patches from seeing the bearer", () => {
    const script = `
      import * as nodeHttp from "node:http";
      import * as nodeNet from "node:net";
      import { EventEmitter } from "node:events";

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
        "Refused a credential-bearing request to protect its token: the node:http member emit was replaced, added or removed after load, and node:http calls it with the request headers in reach. Do not patch node:http, node:net, node:tls, streams or EventEmitter.",
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
      import { fetchWithPinnedAddresses } from "./src/platform/compat/http/pinned-fetch.ts";
      const abort = new AbortController();
      let cancelReason = "";
      const body = new ReadableStream({
        pull() {
          return new Promise(() => {});
        },
        cancel(reason) {
          cancelReason = reason instanceof Error ? reason.name : String(reason);
        },
      });
      const response = fetchWithPinnedAddresses(
        new URL("http://pinned-abort-pending.test/"),
        ["127.0.0.1"],
        { method: "POST", signal: abort.signal, body },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      abort.abort(new DOMException("stop", "AbortError"));
      const result = await response.then(
        () => "resolved",
        (error) => error instanceof Error ? error.name + ":" + error.message : String(error),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log(JSON.stringify({ result, cancelReason }));
    `;

    const output = spawnSync(process.execPath, [
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
