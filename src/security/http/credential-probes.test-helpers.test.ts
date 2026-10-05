import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installGlobalFetchProbe } from "./credential-probes.test-helpers.ts";

describe("global fetch credential probe cleanup", () => {
  it("restores an existing own fetch descriptor", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    assert(original);
    const probe = installGlobalFetchProbe();
    try {
      probe.restore();
      assertEquals(Object.getOwnPropertyDescriptor(globalThis, "fetch"), original);
    } finally {
      Object.defineProperty(globalThis, "fetch", original);
    }
  });

  it("removes its replacement when fetch had no own descriptor", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    assert(original);
    assert(Reflect.deleteProperty(globalThis, "fetch"));
    const probe = installGlobalFetchProbe(() => Promise.resolve(new Response("probe")));
    try {
      probe.restore();
      assertEquals(Object.getOwnPropertyDescriptor(globalThis, "fetch"), undefined);
    } finally {
      Object.defineProperty(globalThis, "fetch", original);
    }
  });
});
