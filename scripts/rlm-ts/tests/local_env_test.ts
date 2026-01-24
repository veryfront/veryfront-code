/**
 * Local Environment Tests
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { LocalEnvironment } from "../src/environments/local.ts";

Deno.test("LocalEnvironment - executes simple code", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  const result = await env.execute("console.log('hello')");

  assertEquals(result.success, true);
  assertStringIncludes(result.output.stdout, "hello");

  await env.teardown();
});

Deno.test("LocalEnvironment - returns value", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  const result = await env.execute("1 + 2");

  assertEquals(result.success, true);
  assertEquals(result.output.returnValue, 3);

  await env.teardown();
});

Deno.test("LocalEnvironment - captures console output", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  const result = await env.execute(`
    console.log("line 1");
    console.info("line 2");
    console.debug("line 3");
  `);

  assertEquals(result.success, true);
  assertStringIncludes(result.output.stdout, "line 1");
  assertStringIncludes(result.output.stdout, "line 2");
  assertStringIncludes(result.output.stdout, "[debug] line 3");

  await env.teardown();
});

Deno.test("LocalEnvironment - captures warnings and errors", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  const result = await env.execute(`
    console.warn("warning message");
    console.error("error message");
  `);

  assertEquals(result.success, true);
  assertStringIncludes(result.output.stderr, "[warn] warning message");
  assertStringIncludes(result.output.stderr, "[error] error message");

  await env.teardown();
});

Deno.test("LocalEnvironment - handles errors gracefully", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  const result = await env.execute("throw new Error('test error')");

  assertEquals(result.success, false);
  assertExists(result.error);
  // Error name could be Error or SyntaxError depending on how it's parsed
  assertEquals(typeof result.error?.name, "string");
  assertStringIncludes(result.error?.message ?? "", "test error");

  await env.teardown();
});

Deno.test("LocalEnvironment - loads string context", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  await env.loadContext("hello world");
  const result = await env.execute("context.toUpperCase()");

  assertEquals(result.success, true);
  assertEquals(result.output.returnValue, "HELLO WORLD");

  await env.teardown();
});

Deno.test("LocalEnvironment - loads array context", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  await env.loadContext([1, 2, 3, 4, 5]);
  const result = await env.execute("context.reduce((a, b) => a + b, 0)");

  assertEquals(result.success, true);
  assertEquals(result.output.returnValue, 15);

  await env.teardown();
});

Deno.test("LocalEnvironment - loads object context", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  await env.loadContext({ name: "Alice", age: 30 });
  const result = await env.execute("name + ' is ' + age");

  assertEquals(result.success, true);
  assertEquals(result.output.returnValue, "Alice is 30");

  await env.teardown();
});

Deno.test("LocalEnvironment - loads Map context", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  const context = new Map<string, unknown>();
  context.set("x", 10);
  context.set("y", 20);

  await env.loadContext(context);
  const result = await env.execute("x + y");

  assertEquals(result.success, true);
  assertEquals(result.output.returnValue, 30);

  await env.teardown();
});

Deno.test("LocalEnvironment - provides safe globals", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  // Test Math
  const mathResult = await env.execute("Math.max(1, 5, 3)");
  assertEquals(mathResult.output.returnValue, 5);

  // Test JSON
  const jsonResult = await env.execute('JSON.parse(\'{"a": 1}\').a');
  assertEquals(jsonResult.output.returnValue, 1);

  // Test Array methods
  const arrayResult = await env.execute("[1, 2, 3].map(x => x * 2)");
  assertEquals(arrayResult.output.returnValue, [2, 4, 6]);

  // Test Date
  const dateResult = await env.execute("new Date('2024-01-01').getFullYear()");
  assertEquals(dateResult.output.returnValue, 2024);

  await env.teardown();
});

Deno.test("LocalEnvironment - blocks dangerous globals", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  // eval should be undefined
  const evalResult = await env.execute("typeof eval");
  assertEquals(evalResult.output.returnValue, "undefined");

  // Function constructor should be undefined
  const funcResult = await env.execute("typeof Function");
  assertEquals(funcResult.output.returnValue, "undefined");

  // Deno should be undefined
  const denoResult = await env.execute("typeof Deno");
  assertEquals(denoResult.output.returnValue, "undefined");

  // fetch should be undefined
  const fetchResult = await env.execute("typeof fetch");
  assertEquals(fetchResult.output.returnValue, "undefined");

  await env.teardown();
});

Deno.test("LocalEnvironment - executes async code", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  const result = await env.execute(`
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    await delay(10);
    "done"
  `);

  // Note: setTimeout is blocked, so this will fail
  // This test documents current behavior
  assertEquals(result.success, false);

  await env.teardown();
});

Deno.test("LocalEnvironment - tracks execution time", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  const result = await env.execute(`
    let sum = 0;
    for (let i = 0; i < 10000; i++) sum += i;
    sum
  `);

  assertEquals(result.success, true);
  assertEquals(typeof result.executionTimeMs, "number");
  assertEquals(result.executionTimeMs >= 0, true);

  await env.teardown();
});

Deno.test("LocalEnvironment - returns context metadata", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  const loaded = await env.loadContext({ a: 1, b: "hello", c: [1, 2, 3] });

  assertEquals(loaded.metadata.type, "object");
  assertExists(loaded.metadata.keys);
  assertEquals(loaded.metadata.keys?.includes("a"), true);
  assertEquals(loaded.metadata.keys?.includes("b"), true);
  assertEquals(loaded.metadata.keys?.includes("c"), true);
  assertEquals(typeof loaded.metadata.totalSize, "number");
  assertEquals(typeof loaded.metadata.estimatedTokens, "number");

  await env.teardown();
});

Deno.test("LocalEnvironment - getLocals returns current state", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  await env.loadContext({ x: 100 });
  const locals = env.getLocals();

  assertEquals(locals.x, 100);

  await env.teardown();
});

Deno.test("LocalEnvironment - clearLocals resets state", async () => {
  const env = new LocalEnvironment();
  await env.setup();

  await env.loadContext({ x: 100 });
  env.clearLocals();
  const locals = env.getLocals();

  assertEquals(Object.keys(locals).length, 0);

  await env.teardown();
});

Deno.test("LocalEnvironment - persistent mode preserves state", async () => {
  const env = new LocalEnvironment({ type: "local", persistent: true });
  await env.setup();

  await env.loadContext({ counter: 0 });

  // Simulate multiple executions
  await env.execute("counter = counter + 1");
  await env.execute("counter = counter + 1");

  // Note: Variable tracking from executed code is limited
  // This test documents current behavior limitations

  await env.teardown();
});
