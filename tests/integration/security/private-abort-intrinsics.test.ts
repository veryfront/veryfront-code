import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { joinPrivateAbortSignals } from "#veryfront/security/private-abort.ts";

it("private signal joins ignore replaced static and array iterator hooks", () => {
  const first = new AbortController(), second = new AbortController();
  const any = AbortSignal.any, iterate = Array.prototype[Symbol.iterator];
  let signal: AbortSignal;
  try {
    AbortSignal.any = () => new AbortController().signal;
    Array.prototype[Symbol.iterator] = function () {
      return iterate.call([]);
    };
    signal = joinPrivateAbortSignals(first.signal, second.signal);
  } finally {
    AbortSignal.any = any;
    Array.prototype[Symbol.iterator] = iterate;
  }
  second.abort();
  assertEquals(signal.aborted, true);
});
