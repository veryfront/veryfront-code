import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { findSequential, forEachSequential } from "./sequential.ts";

it("serial dispatch waits for each side effect and stops after rejection", async () => {
  const calls: number[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => release = resolve);
  const result = forEachSequential([1, 2, 3], async (value) => {
    calls.push(value);
    if (value === 1) await pending;
    if (value === 2) throw new Error("stop");
  });
  assertEquals(calls, [1]);
  const rejected = assertRejects(() => result, Error, "stop");
  release();
  await rejected;
  assertEquals(calls, [1, 2]);
});

it("sequential operations skip inherited entries and stop at the first match", async () => {
  const values = [1, , 3, 4];
  Object.setPrototypeOf(values, { 1: 2 });
  const calls: number[] = [];
  assertEquals(
    await findSequential(values, async (value) => {
      calls.push(value!);
      return value === 3;
    }),
    3,
  );
  assertEquals(calls, [1, 3]);
  calls.length = 0;
  await forEachSequential(values, async (value) => {
    calls.push(value!);
  });
  assertEquals(calls, [1, 3, 4]);
  assertEquals(await findSequential([], async () => true), undefined);
  assertEquals(await findSequential([1], async () => false), undefined);
});
