import { assertEquals, assertThrows } from "./assert.ts";
import { describe, it } from "./bdd.ts";
import {
  assertBunTestModule,
  type BunRegistrationOptions,
  type BunTestModule,
  registerBunSuite,
  registerBunTest,
} from "./bun-adapter.ts";

type Call = {
  kind: string;
  name: string;
  timeout?: number;
};

function createFakeBunModule(calls: Call[]): BunTestModule {
  const describeRunner = Object.assign(
    (name: string, _fn: () => void) => calls.push({ kind: "describe", name }),
    {
      skip: (name: string, _fn: () => void) => calls.push({ kind: "describe.skip", name }),
      only: (name: string, _fn: () => void) => calls.push({ kind: "describe.only", name }),
    },
  );
  const testRunner = Object.assign(
    (name: string, _fn: () => void | Promise<void>, timeout?: number) =>
      calls.push({ kind: "it", name, timeout }),
    {
      skip: (name: string, _fn: () => void | Promise<void>, timeout?: number) =>
        calls.push({ kind: "it.skip", name, timeout }),
      only: (name: string, _fn: () => void | Promise<void>, timeout?: number) =>
        calls.push({ kind: "it.only", name, timeout }),
      serial: Object.assign(
        (name: string, _fn: () => void | Promise<void>, timeout?: number) =>
          calls.push({ kind: "it.serial", name, timeout }),
        {
          skip: (name: string, _fn: () => void | Promise<void>, timeout?: number) =>
            calls.push({ kind: "it.serial.skip", name, timeout }),
          only: (name: string, _fn: () => void | Promise<void>, timeout?: number) =>
            calls.push({ kind: "it.serial.only", name, timeout }),
        },
      ),
    },
  );

  return {
    describe: describeRunner,
    it: testRunner,
    beforeEach: () => undefined,
    afterEach: () => undefined,
    beforeAll: () => undefined,
    afterAll: () => undefined,
  };
}

describe("testing/bun-adapter", () => {
  it("requires Bun's named test exports and modifiers", () => {
    const calls: Call[] = [];
    const module = createFakeBunModule(calls);
    assertBunTestModule(module);

    assertThrows(
      () => assertBunTestModule({ default: module }),
      TypeError,
      'required named export "describe"',
    );
    assertThrows(
      () =>
        assertBunTestModule({
          ...module,
          it: Object.assign(() => undefined, {
            only: () => undefined,
            serial: module.it.serial,
          }),
        }),
      TypeError,
      "it.skip",
    );
    assertThrows(
      () =>
        assertBunTestModule({
          ...module,
          it: Object.assign(() => undefined, {
            skip: () => undefined,
            only: () => undefined,
          }),
        }),
      TypeError,
      "it.serial",
    );
  });

  it("uses Bun's positional timeout and preserves zero and infinite timeouts", () => {
    const calls: Call[] = [];
    const module = createFakeBunModule(calls);
    const fn = () => undefined;
    const focusedOptions: BunRegistrationOptions = { timeout: Infinity };
    focusedOptions.only = true;
    const ignoredOptions: BunRegistrationOptions = { timeout: 10 };
    ignoredOptions.ignore = true;

    registerBunTest(module, "default", {}, fn, 30_000);
    registerBunTest(module, "zero", { timeout: 0 }, fn, 30_000);
    registerBunTest(module, "infinite", focusedOptions, fn, 30_000);
    registerBunTest(module, "ignored", ignoredOptions, fn, 30_000);

    assertEquals(calls, [
      { kind: "it.serial", name: "default", timeout: 30_000 },
      { kind: "it.serial", name: "zero", timeout: 0 },
      { kind: "it.serial.only", name: "infinite", timeout: Infinity },
      { kind: "it.serial.skip", name: "ignored", timeout: undefined },
    ]);
  });

  it("uses Bun's suite modifiers without running ignored suites", () => {
    const calls: Call[] = [];
    const module = createFakeBunModule(calls);
    const fn = () => undefined;
    const focusedOptions: BunRegistrationOptions = {};
    focusedOptions.only = true;
    const ignoredFocusedOptions: BunRegistrationOptions = {};
    ignoredFocusedOptions.ignore = true;
    ignoredFocusedOptions.only = true;

    registerBunSuite(module, "normal", {}, fn);
    registerBunSuite(module, "focused", focusedOptions, fn);
    registerBunSuite(module, "ignored", ignoredFocusedOptions, fn);

    assertEquals(calls, [
      { kind: "describe", name: "normal" },
      { kind: "describe.only", name: "focused" },
      { kind: "describe.skip", name: "ignored" },
    ]);
  });
});
