/**
 * Integration test for dynamic ESM imports in compiled Deno binaries.
 *
 * This test proves that the fetch + rewrite + file:// approach works in compiled binaries,
 * which is critical for loading Tailwind plugins dynamically at runtime.
 *
 * To run:
 *   deno test --allow-all tests/integration/dynamic-esm-import.test.ts
 *
 * To test in compiled binary:
 *   deno compile --allow-all --unstable-net -o /tmp/test-dynamic-esm tests/integration/dynamic-esm-import.test.ts
 *   /tmp/test-dynamic-esm
 */

import plugin from "tailwindcss/plugin";

// Set up global shim for tailwindcss/plugin - same as in tailwind-compiler.ts
(globalThis as Record<string, unknown>).__tailwindPluginShim = {
  default: plugin,
  __esModule: true,
};

/**
 * Load a module dynamically from esm.sh.
 * Works in both regular Deno and compiled binaries.
 */
async function loadModuleFromEsmSh(packageName: string): Promise<unknown> {
  const stubUrl = `https://esm.sh/${packageName}?bundle&external=tailwindcss`;
  console.log(`Fetching stub: ${stubUrl}`);

  const stubResponse = await fetch(stubUrl);
  if (!stubResponse.ok) throw new Error(`Failed to fetch stub: ${stubResponse.status}`);

  const stubCode = await stubResponse.text();
  const bundleMatch = stubCode.match(/from\s*["'](\/[^"']+\.bundle\.mjs)["']/);
  if (!bundleMatch) {
    throw new Error(
      `Could not find bundle path in esm.sh response: ${stubCode.substring(0, 200)}`,
    );
  }

  const bundleUrl = `https://esm.sh${bundleMatch[1]}`;
  console.log(`Fetching bundle: ${bundleUrl}`);

  const bundleResponse = await fetch(bundleUrl);
  if (!bundleResponse.ok) throw new Error(`Failed to fetch bundle: ${bundleResponse.status}`);

  let code = await bundleResponse.text();

  const tailwindImport = 'import*as __0$ from"tailwindcss/plugin"';
  if (code.includes(tailwindImport)) {
    code = code.replace(tailwindImport, "const __0$ = globalThis.__tailwindPluginShim");
    console.log("Rewrote tailwindcss/plugin import");
  }

  const tempPath = `/tmp/tw_plugin_${crypto.randomUUID()}.mjs`;
  await Deno.writeTextFile(tempPath, code);
  console.log(`Wrote to temp file: ${tempPath}`);

  try {
    const mod = await import(`file://${tempPath}`);
    console.log("Successfully imported module");
    return mod;
  } finally {
    await Deno.remove(tempPath).catch(() => {});
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Main test
async function runTests(): Promise<void> {
  console.log("\n=== Dynamic ESM Import Integration Test ===\n");

  console.log("Test 1: Loading tailwindcss-animate@1.0.7...");
  try {
    const mod = await loadModuleFromEsmSh("tailwindcss-animate@1.0.7");
    const pluginExport = (mod as { default: unknown }).default;

    assert(typeof pluginExport === "object" && pluginExport !== null, `Expected object, got ${typeof pluginExport}`);
    assert("handler" in pluginExport, "Plugin missing 'handler' property");

    console.log("✅ Test 1 PASSED: tailwindcss-animate loaded successfully\n");
  } catch (error) {
    console.error(`❌ Test 1 FAILED: ${getErrorMessage(error)}\n`);
    Deno.exit(1);
  }

  console.log("Test 2: Loading is-odd@3.0.1...");
  try {
    const mod = await loadModuleFromEsmSh("is-odd@3.0.1");
    const isOdd = (mod as { default: (n: number) => boolean }).default;

    assert(typeof isOdd === "function", `Expected function, got ${typeof isOdd}`);
    assert(isOdd(3) === true, "isOdd(3) should return true");
    assert(isOdd(4) === false, "isOdd(4) should return false");

    console.log("✅ Test 2 PASSED: is-odd loaded and works correctly\n");
  } catch (error) {
    console.error(`❌ Test 2 FAILED: ${getErrorMessage(error)}\n`);
    Deno.exit(1);
  }

  console.log("=== All tests passed! ===\n");
}

// Run tests if executed directly
if (import.meta.main) {
  await runTests();
}

// Export for use as a Deno test
export { runTests };
