import "#veryfront/schemas/_test-setup.ts";
import { runWithProjectRunInferenceCredential } from "#veryfront/agent/runtime/project-run-inference-credential.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import {
  getActiveRunEventSink,
  getActiveRunEventSinks,
  runWithMandatoryRunEventSink,
  runWithRunEventSink,
  scopeAsyncIterableWithMandatoryRunEventSink,
} from "#veryfront/runtime/run-event-sink-context.ts";

const mandatory: AgentRunEventSink = () => {};
const publicSink: AgentRunEventSink = () => {};

describe("mandatory run event sink private async context", () => {
  for (const patched of ["getStore", "run", "both"]) {
    it(`preserves mandatory and public lanes when project code replaces ${patched}`, () => {
      const run = AsyncLocalStorage.prototype.run;
      const getStore = AsyncLocalStorage.prototype.getStore;
      let observed: ReturnType<typeof getActiveRunEventSinks> | undefined;
      let selected: AgentRunEventSink | undefined;
      try {
        runWithMandatoryRunEventSink(mandatory, () => {
          if (patched !== "run") AsyncLocalStorage.prototype.getStore = () => undefined;
          if (patched !== "getStore") {
            AsyncLocalStorage.prototype.run = () => {
              throw new Error("project replacement");
            };
          }
          runWithRunEventSink(publicSink, () => {
            observed = getActiveRunEventSinks();
            selected = getActiveRunEventSink();
          });
        });
      } finally {
        AsyncLocalStorage.prototype.run = run;
        AsyncLocalStorage.prototype.getStore = getStore;
      }
      assertStrictEquals(observed?.mandatory, mandatory);
      assertStrictEquals(observed?.public, publicSink);
      assertStrictEquals(selected, publicSink);
      assertEquals(getActiveRunEventSinks(), { mandatory: undefined, public: undefined });
    });
  }

  it("retains the mandatory sink through lazy iteration even when project getStore forges that sink", async () => {
    const observed: (AgentRunEventSink | undefined)[] = [];
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        observed.push(getActiveRunEventSinks().mandatory);
        return {
          next() {
            observed.push(getActiveRunEventSinks().mandatory);
            return Promise.resolve({ value: "output", done: false });
          },
          return() {
            observed.push(getActiveRunEventSinks().mandatory);
            return Promise.resolve({ value: "done", done: true });
          },
        };
      },
    };
    const wrapped = scopeAsyncIterableWithMandatoryRunEventSink(mandatory, source);
    const run = AsyncLocalStorage.prototype.run;
    const getStore = AsyncLocalStorage.prototype.getStore;
    let next: Promise<IteratorResult<string>> | undefined;
    let returned: Promise<IteratorResult<string>> | undefined;
    try {
      AsyncLocalStorage.prototype.getStore = () => mandatory;
      AsyncLocalStorage.prototype.run = () => {
        throw new Error("project replacement");
      };
      const iterator = wrapped[Symbol.asyncIterator]();
      next = Promise.resolve(iterator.next());
      returned = iterator.return ? Promise.resolve(iterator.return()) : undefined;
    } finally {
      AsyncLocalStorage.prototype.run = run;
      AsyncLocalStorage.prototype.getStore = getStore;
    }
    assertEquals(await next, { value: "output", done: false });
    assertEquals(await returned, { value: "done", done: true });
    assertEquals(observed, [mandatory, mandatory, mandatory]);
    assertEquals(getActiveRunEventSinks(), { mandatory: undefined, public: undefined });
  });
});

describe("private inference credential async context", () => {
  it("does not expose its storage or credential through project async-context methods", async () => {
    const run = AsyncLocalStorage.prototype.run;
    const getStore = AsyncLocalStorage.prototype.getStore;
    const apply = Reflect.apply;
    const observedStorages: AsyncLocalStorage<unknown>[] = [];
    const token = "synthetic-private-inference-token";
    let credentialExposed = false;
    let completed = false;
    let operation: Promise<void> | undefined;
    try {
      AsyncLocalStorage.prototype.getStore = function (this: AsyncLocalStorage<unknown>) {
        observedStorages.push(this);
        return apply(getStore, this, []);
      };
      AsyncLocalStorage.prototype.run = () => {
        throw new Error("project replacement");
      };
      operation = runWithProjectRunInferenceCredential(token, async () => {
        credentialExposed = observedStorages.some((storage) => {
          const value: unknown = apply(getStore, storage, []);
          return typeof value === "object" && value !== null && "credential" in value &&
            value.credential === token;
        });
        completed = true;
      });
    } finally {
      AsyncLocalStorage.prototype.run = run;
      AsyncLocalStorage.prototype.getStore = getStore;
    }
    await operation;
    assertEquals(completed, true);
    assertEquals(credentialExposed, false);
  });
});
