import { assertEquals, assertNotStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  getHostedRequestPreparationSignal,
  resolveHostedRequestPreparationSignal,
  runWithHostedRequestPreparationSignal,
} from "./request-preparation-context.ts";

Deno.test("hosted request preparation context preserves exact signal identity", () => {
  const signal = new AbortController().signal;

  runWithHostedRequestPreparationSignal(signal, () => {
    assertEquals(getHostedRequestPreparationSignal(), signal);
    assertEquals(resolveHostedRequestPreparationSignal(), signal);
  });

  assertEquals(getHostedRequestPreparationSignal(), undefined);
});

Deno.test("hosted request preparation context isolates concurrent operations", async () => {
  const firstSignal = new AbortController().signal;
  const secondSignal = new AbortController().signal;
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });

  const first = runWithHostedRequestPreparationSignal(firstSignal, async () => {
    await firstGate;
    return getHostedRequestPreparationSignal();
  });
  const second = runWithHostedRequestPreparationSignal(secondSignal, async () => {
    await secondGate;
    return getHostedRequestPreparationSignal();
  });

  releaseSecond();
  assertEquals(await second, secondSignal);
  releaseFirst();
  assertEquals(await first, firstSignal);
  assertEquals(getHostedRequestPreparationSignal(), undefined);
});

Deno.test("hosted request preparation context restores nested and throwing scopes", () => {
  const outerSignal = new AbortController().signal;
  const innerSignal = new AbortController().signal;

  runWithHostedRequestPreparationSignal(outerSignal, () => {
    runWithHostedRequestPreparationSignal(innerSignal, () => {
      assertEquals(getHostedRequestPreparationSignal(), innerSignal);
    });
    assertEquals(getHostedRequestPreparationSignal(), outerSignal);

    assertThrows(
      () =>
        runWithHostedRequestPreparationSignal(innerSignal, () => {
          throw new Error("preparation failed");
        }),
      Error,
      "preparation failed",
    );
    assertEquals(getHostedRequestPreparationSignal(), outerSignal);
  });

  assertEquals(getHostedRequestPreparationSignal(), undefined);
});

Deno.test("direct hosted preparation calls receive fresh non-aborted fallback signals", () => {
  const firstSignal = resolveHostedRequestPreparationSignal();
  const secondSignal = resolveHostedRequestPreparationSignal();

  assertEquals(firstSignal.aborted, false);
  assertEquals(secondSignal.aborted, false);
  assertNotStrictEquals(firstSignal, secondSignal);
  assertEquals(getHostedRequestPreparationSignal(), undefined);
});
