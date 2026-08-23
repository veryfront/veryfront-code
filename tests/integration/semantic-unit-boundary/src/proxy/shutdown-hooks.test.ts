import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProxyShutdownAggregateError,
  createProxyShutdownHooks,
} from "veryfront/proxy/shutdown-hooks";

describe("proxy shutdown hooks", () => {
  it("awaits every hook once and rejects late registration", async () => {
    const hooks = createProxyShutdownHooks();
    const gate = Promise.withResolvers<void>();
    const events: string[] = [];
    hooks.register(() => {
      events.push("sync");
    });
    hooks.register(async () => {
      events.push("async-start");
      await gate.promise;
      events.push("async-end");
    });

    const settlement = hooks.settle();
    assertStrictEquals(hooks.settle(), settlement);
    assertThrows(
      () => hooks.register(() => undefined),
      Error,
      "already started",
    );
    await Promise.resolve();
    assertEquals(events, ["sync", "async-start"]);

    gate.resolve();
    assertEquals(await settlement, []);
    assertEquals(events, ["sync", "async-start", "async-end"]);
  });

  it("reports hook failures after allowing peer cleanup to finish", async () => {
    const hooks = createProxyShutdownHooks();
    const completed: string[] = [];
    hooks.register(() => {
      throw new Error("synchronous teardown failed");
    });
    hooks.register(() =>
      Promise.reject(new Error("asynchronous teardown failed"))
    );
    hooks.register(() => {
      completed.push("peer completed");
    });

    const failures = await hooks.settle();

    assertEquals(completed, ["peer completed"]);
    assertEquals(
      failures.map((failure) =>
        failure instanceof Error ? failure.message : String(failure)
      ),
      ["synchronous teardown failed", "asynchronous teardown failed"],
    );
  });

  it("aggregates failures for callers that require successful teardown", async () => {
    const hooks = createProxyShutdownHooks();
    hooks.register(() => {
      throw "primitive teardown failure";
    });
    hooks.register(() => Promise.reject(new Error("error teardown failure")));

    const error = await assertRejects(
      hooks.settleOrThrow,
      AggregateError,
      "Proxy extension owner teardown failed",
    );
    assertEquals(
      (error as AggregateError).errors.map((failure) =>
        failure instanceof Error ? failure.message : String(failure)
      ),
      ["primitive teardown failure", "error teardown failure"],
    );
  });

  it("aggregates without consulting the mutable Array iterator prototype", () => {
    const iteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
    const nextDescriptor = Object.getOwnPropertyDescriptor(
      iteratorPrototype,
      "next",
    )!;
    let aggregate: AggregateError | undefined;

    try {
      Object.defineProperty(iteratorPrototype, "next", {
        ...nextDescriptor,
        value: () => {
          throw new Error("poisoned Array iterator next");
        },
      });
      aggregate = createProxyShutdownAggregateError(
        ["first", "second"],
        "aggregate test",
      );
    } finally {
      Object.defineProperty(iteratorPrototype, "next", nextDescriptor);
    }

    assertEquals(aggregate?.message, "aggregate test");
    assertEquals(aggregate?.errors.length, 2);
    assertEquals(aggregate?.errors[0], "first");
    assertEquals(aggregate?.errors[1], "second");
  });

  it("disposes the exact registration idempotently", async () => {
    const hooks = createProxyShutdownHooks();
    let calls = 0;
    const hook = () => {
      calls++;
    };
    const disposeFirst = hooks.register(hook);
    hooks.register(hook);

    disposeFirst();
    disposeFirst();
    assertEquals(await hooks.settle(), []);
    assertEquals(calls, 1);
  });

  it("rejects non-function hooks", () => {
    const hooks = createProxyShutdownHooks();
    assertThrows(
      () => hooks.register(null as never),
      TypeError,
      "must be a function",
    );
  });

  it("uses collection and Promise intrinsics captured before extension mutation", async () => {
    const hooks = createProxyShutdownHooks();
    const targets: Array<readonly [object, string]> = [
      [Map.prototype, "set"],
      [Map.prototype, "delete"],
      [Map.prototype, "forEach"],
      [Map.prototype, "clear"],
      [Promise, "resolve"],
      [Promise, "allSettled"],
    ];
    const descriptors = targets.map(([target, property]) =>
      Object.getOwnPropertyDescriptor(target, property)!
    );
    let settlement: Promise<readonly unknown[]> | undefined;

    try {
      for (let index = 0; index < targets.length; index++) {
        const [target, property] = targets[index]!;
        Object.defineProperty(target, property, {
          ...descriptors[index],
          value: () => {
            throw new Error(`poisoned ${property}`);
          },
        });
      }
      hooks.register(() => undefined);
      settlement = hooks.settle();
    } finally {
      for (let index = 0; index < targets.length; index++) {
        const [target, property] = targets[index]!;
        Object.defineProperty(target, property, descriptors[index]!);
      }
    }

    assertEquals(await settlement, []);
  });
});
