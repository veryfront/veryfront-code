import "#veryfront/schemas/_test-setup.ts";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createNodeRequestListener } from "./http-server.ts";
import { toNodeHandler } from "#veryfront/server/node-handler.ts";
import {
  completeRequestTrackingOnResponseEnd,
  startRequestTracking,
} from "#veryfront/server/runtime-handler/request-lifecycle.ts";
import { requestTracker } from "#veryfront/server/runtime-handler/request-tracker.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => resolve = r);
  return { promise, resolve };
}
function turn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

for (const adapter of ["runtime", "public"] as const) {
  describe(`${adapter} Node discarded response`, () => {
    for (const cancellation of ["complete", "pending", "reject"] as const) {
      it(`cancels a body returned after disconnect and retains ownership until cancellation ${cancellation}`, async () => {
        const started = deferred(), releaseHandler = deferred(), releaseCancellation = deferred();
        const requestId = `discard-${adapter}-${cancellation}`;
        const before = requestTracker.getInFlightCount();
        let cancelCalls = 0, writes = 0, sourceCanceled = false;
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const source = new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
          async cancel() {
            sourceCanceled = true;
            cancelCalls++;
            if (cancellation === "pending") await releaseCancellation.promise;
            if (cancellation === "reject") throw new Error("source cancellation failed");
          },
        }, { highWaterMark: 0 });
        const handler = async () => {
          startRequestTracking(requestId, undefined, "/discard", "GET", undefined, undefined);
          started.resolve();
          await releaseHandler.promise;
          return completeRequestTrackingOnResponseEnd(requestId, new Response(source), false);
        };
        const req = Object.assign(new EventEmitter(), {
          method: "GET",
          url: "/discard",
          headers: { host: "localhost" },
          socket: {},
          aborted: false,
        });
        const res = Object.assign(new EventEmitter(), {
          destroyed: false,
          writableEnded: false,
          writableFinished: false,
          headersSent: false,
          writeHead() {
            writes++;
          },
          setHeader() {
            writes++;
          },
          write() {
            writes++;
            return true;
          },
          end() {
            writes++;
          },
          destroy() {
            this.destroyed = true;
          },
        });
        const listener = adapter === "runtime"
          ? createNodeRequestListener(handler)
          : toNodeHandler(handler);
        const running = Promise.resolve(
          listener(req as unknown as IncomingMessage, res as unknown as ServerResponse),
        );
        try {
          await started.promise;
          res.destroyed = true;
          res.emit("close");
          releaseHandler.resolve();
          await turn();
          assertEquals(
            cancelCalls,
            1,
            "the response must be cancelled even when close preceded handler return",
          );
          assertEquals(writes, 0, "a disconnected peer must receive no headers or body writes");
          if (cancellation === "pending") {
            assertEquals(
              requestTracker.getInFlightCount(),
              before + 1,
              "pending source cleanup still owns tracking",
            );
            releaseCancellation.resolve();
          }
          await running;
          await turn();
          assertEquals(requestTracker.getInFlightCount(), before);
          res.emit("close");
          assertEquals(cancelCalls, 1, "repeated close must not repeat cancellation");
        } finally {
          releaseHandler.resolve();
          releaseCancellation.resolve();
          if (!sourceCanceled) controller.close();
          await running;
          await turn();
          requestTracker.complete(requestId, 499);
          requestTracker.shutdown();
        }
      });
    }
  });
}
