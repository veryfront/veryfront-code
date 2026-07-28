import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { getRemoteToolProvenance, markRemoteToolProvenance } from "./remote-tool-provenance.ts";

Deno.test("remote tool provenance is own immutable data", () => {
  const tool = markRemoteToolProvenance({}, "gmail__list_emails");
  const symbol = Reflect.ownKeys(tool).find((key): key is symbol => typeof key === "symbol");
  if (!symbol) throw new Error("Missing remote tool provenance symbol");

  assertEquals(getRemoteToolProvenance(tool), "gmail__list_emails");
  assertEquals(Reflect.getOwnPropertyDescriptor(tool, symbol), {
    value: "gmail__list_emails",
    writable: false,
    enumerable: true,
    configurable: false,
  });
});

Deno.test("remote tool provenance lookup does not invoke accessors or inherited markers", () => {
  const marked = markRemoteToolProvenance({}, "gmail__list_emails");
  const symbol = Reflect.ownKeys(marked).find((key): key is symbol => typeof key === "symbol");
  if (!symbol) throw new Error("Missing remote tool provenance symbol");

  let getterCalls = 0;
  const accessor = Object.defineProperty({}, symbol, {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "gmail__delete_email";
    },
  });
  const inherited = Object.create(marked);

  assertEquals(getRemoteToolProvenance(accessor), undefined);
  assertEquals(getRemoteToolProvenance(inherited), undefined);
  assertEquals(getterCalls, 0);
});

Deno.test("remote tool provenance rejects an empty canonical name", () => {
  assertThrows(
    () => markRemoteToolProvenance({}, ""),
    TypeError,
    "non-empty",
  );
});
