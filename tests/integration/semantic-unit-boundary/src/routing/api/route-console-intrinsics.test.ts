import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { formatRouteConsoleMessage } from "#veryfront/routing/api/route-console.ts";

// Host-realm route code can replace built-in prototype methods. Formatting its
// console output must not call them, or the line is lost and redaction skipped.
it("formats route console output without calling replaced prototype methods", () => {
  const fail = () => {
    throw new Error("tampered");
  };
  const saved = {
    join: Array.prototype.join,
    map: Array.prototype.map,
    push: Array.prototype.push,
    has: Set.prototype.has,
    includes: String.prototype.includes,
  };
  Array.prototype.join = fail;
  Array.prototype.map = fail;
  Array.prototype.push = fail;
  Set.prototype.has = fail;
  String.prototype.includes = fail;
  let message: string;
  try {
    message = formatRouteConsoleMessage(["%s rows", 2, { password: "x", list: [1, "a"] }]);
  } finally {
    Array.prototype.join = saved.join;
    Array.prototype.map = saved.map;
    Array.prototype.push = saved.push;
    Set.prototype.has = saved.has;
    String.prototype.includes = saved.includes;
  }
  assertEquals(message, '2 rows {"password":[REDACTED],"list":[1,"a"]}');
});
