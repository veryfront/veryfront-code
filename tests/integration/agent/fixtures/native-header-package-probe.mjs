// Linux Actions only. Retained Node v1 invocation from an installed package:
// node --input-type=module < native-header-package-probe.mjs
// Only synthetic data is used. Install the transport stub before importing the package.
import assert from "node:assert/strict";
import process from "node:process";
const isNode = typeof Bun === "undefined" && typeof Deno === "undefined";
let fetches = 0;
globalThis.fetch = async () => {
  fetches++;
  throw new Error("Network prohibited in native header probe");
};
const { defineAgentService } = await import("veryfront/agent");
const canary = "synthetic-package-header-canary";
const headers = new Headers({ "X-Veryfront-Inference-Token": canary });
const response = new Response(null);
let handled = 0;
let rejected = 0;
const runtime = defineAgentService({
  serviceName: "native-header-package-probe",
  agents: {},
  defaultAgentId: "test",
}).createRuntime({
  routes: [{
    method: "GET",
    path: "/check",
    handler: ({ request }) => {
      assert.equal(request.method, "GET", "inherited method changed a valid request");
      handled++;
      return response;
    },
  }],
});
const original = Function.prototype.call;
const apply = Reflect.apply;
let observations = 0;
let failure;
let returned;
Function.prototype.call = new Proxy(original, {
  apply(target, receiver, args) {
    if (args[1] === canary) observations++;
    return apply(target, receiver, args);
  },
});
try {
  returned = await runtime.request("/check", { headers });
} catch (error) {
  failure = error;
} finally {
  Function.prototype.call = original;
}
assert.equal(observations, 0, "credential reached modified callback");
if (isNode) {
  assert(failure instanceof TypeError);
  rejected++;
  assert.equal(handled, 0);
} else {
  assert.equal(failure, undefined);
  assert.equal(returned, response);
  assert.equal(handled, 1);
}
const iteratorPrototype = Object.getPrototypeOf(headers.entries());
const originalNext = Object.getOwnPropertyDescriptor(iteratorPrototype, "next");
Object.defineProperty(iteratorPrototype, "next", {
  ...originalNext,
  value: function () {
    const result = apply(originalNext.value, this, []);
    if (result.value?.[1] === canary) observations++;
    return result;
  },
});
failure = undefined;
returned = undefined;
try {
  returned = await runtime.request("/check", { headers });
} catch (error) {
  failure = error;
} finally {
  Object.defineProperty(iteratorPrototype, "next", originalNext);
}
assert.equal(observations, 0, "credential reached modified iterator");
if (isNode) {
  assert(failure instanceof TypeError);
  rejected++;
  assert.equal(handled, 0);
} else {
  assert.equal(failure, undefined);
  assert.equal(returned, response);
  assert.equal(handled, 2);
}
const originalMethod = Object.getOwnPropertyDescriptor(Object.prototype, "method");
Object.defineProperty(Object.prototype, "method", {
  configurable: true,
  writable: true,
  value: "POST",
});
failure = undefined;
returned = undefined;
try {
  returned = await runtime.request("/check");
} catch (error) {
  failure = error;
} finally {
  if (originalMethod) Object.defineProperty(Object.prototype, "method", originalMethod);
  else Reflect.deleteProperty(Object.prototype, "method");
}
if (isNode) {
  assert(failure instanceof TypeError);
  rejected++;
  assert.equal(handled, 0);
} else {
  assert.equal(failure, undefined);
  assert.equal(returned, response);
  assert.equal(handled, 3);
}
const safeRequests = handled;
assert.equal(await runtime.request("/check", { headers }), response);
assert.equal(handled, safeRequests + 1);
assert.equal(fetches, 0);
console.log(JSON.stringify({
  node: process.versions.node,
  undici: process.versions.undici,
  observations,
  fetches,
  rejected,
  cleanRequests: handled - safeRequests,
  ...(!isNode ? { safeRequests } : {}),
}));
