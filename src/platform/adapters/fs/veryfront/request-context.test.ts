import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  getCurrentRequestContext,
  registerRequestContextFinalizer,
  runWithRequestContextResponse,
} from "./request-context.ts";

const requestOptions = {
  projectSlug: "stream-project",
  projectId: "stream-project-id",
  token: "stream-token",
  productionMode: false,
} as const;

Deno.test("runWithRequestContextResponse retains context until the body closes", async () => {
  const observedProjectSlugs: Array<string | null> = [];
  let finalizerCalls = 0;

  const response = await runWithRequestContextResponse(requestOptions, async () => {
    const context = getCurrentRequestContext();
    if (!context) throw new Error("Expected an active request context");
    registerRequestContextFinalizer(context, () => {
      finalizerCalls += 1;
    });

    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          observedProjectSlugs.push(getCurrentRequestContext()?.projectSlug ?? null);
          controller.enqueue(new TextEncoder().encode("streamed"));
          controller.close();
        },
      }),
    );
  });

  assertEquals(finalizerCalls, 0);
  assertEquals(await response.text(), "streamed");
  await Promise.resolve();

  assertEquals(observedProjectSlugs, ["stream-project"]);
  assertEquals(finalizerCalls, 1);
});

Deno.test("runWithRequestContextResponse finalizes context when the body is cancelled", async () => {
  let finalizerCalls = 0;
  let cancellationReason: unknown;

  const response = await runWithRequestContextResponse(requestOptions, async () => {
    const context = getCurrentRequestContext();
    if (!context) throw new Error("Expected an active request context");
    registerRequestContextFinalizer(context, () => {
      finalizerCalls += 1;
    });

    return new Response(
      new ReadableStream<Uint8Array>({
        cancel(reason) {
          cancellationReason = reason;
        },
      }),
    );
  });

  assertEquals(finalizerCalls, 0);
  await response.body?.cancel("consumer-stopped");
  await Promise.resolve();

  assertEquals(cancellationReason, "consumer-stopped");
  assertEquals(finalizerCalls, 1);
});

Deno.test("runWithRequestContextResponse propagates body errors and finalizes context", async () => {
  let finalizerCalls = 0;

  const response = await runWithRequestContextResponse(requestOptions, async () => {
    const context = getCurrentRequestContext();
    if (!context) throw new Error("Expected an active request context");
    registerRequestContextFinalizer(context, () => {
      finalizerCalls += 1;
    });

    return new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          throw new Error("stream failed");
        },
      }),
    );
  });

  await assertRejects(() => response.text(), Error, "stream failed");
  await Promise.resolve();
  assertEquals(finalizerCalls, 1);
});
