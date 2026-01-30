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
  // Step 1: Fetch the redirect stub to find the actual bundle URL
  const stubUrl = `https://esm.sh/${packageName}?bundle&external=tailwindcss`;
  console.log(`Fetching stub: ${stubUrl}`);

  const stubResponse = await fetch(stubUrl);
  if (!stubResponse.ok) {
    throw new Error(`Failed to fetch stub: ${stubResponse.status}`);
  }
  const stubCode = await stubResponse.text();

  // Step 2: Parse stub to find actual bundle path
  const bundleMatch = stubCode.match(/from\s*["'](\/[^"']+\.bundle\.mjs)["']/);
  if (!bundleMatch) {
    throw new Error(`Could not find bundle path in esm.sh response: ${stubCode.substring(0, 200)}`);
  }

  const bundleUrl = `https://esm.sh${bundleMatch[1]}`;
  console.log(`Fetching bundle: ${bundleUrl}`);

  // Step 3: Fetch the actual bundled code
  const bundleResponse = await fetch(bundleUrl);
  if (!bundleResponse.ok) {
    throw new Error(`Failed to fetch bundle: ${bundleResponse.status}`);
  }
  let code = await bundleResponse.text();

  // Step 4: Rewrite tailwindcss/plugin import to use our global shim
  const tailwindImport = 'import*as __0$ from"tailwindcss/plugin"';
  if (code.includes(tailwindImport)) {
    code = code.replace(tailwindImport, "const __0$ = globalThis.__tailwindPluginShim");
    console.log("Rewrote tailwindcss/plugin import");
  }

  // Step 5: Write to temp file and import
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

// Main test
async function runTests() {
  console.log("\n=== Dynamic ESM Import Integration Test ===\n");

  // Test 1: Load tailwindcss-animate
  console.log("Test 1: Loading tailwindcss-animate@1.0.7...");
  try {
    const mod = await loadModuleFromEsmSh("tailwindcss-animate@1.0.7");
    const pluginExport = (mod as { default: unknown }).default;

    if (typeof pluginExport !== "object" || pluginExport === null) {
      throw new Error(`Expected object, got ${typeof pluginExport}`);
    }

    if (!("handler" in pluginExport)) {
      throw new Error("Plugin missing 'handler' property");
    }

    console.log("✅ Test 1 PASSED: tailwindcss-animate loaded successfully\n");
  } catch (error) {
    console.error(`❌ Test 1 FAILED: ${error instanceof Error ? error.message : error}\n`);
    Deno.exit(1);
  }

  // Test 2: Load is-odd (simple package, no tailwindcss dependency)
  console.log("Test 2: Loading is-odd@3.0.1...");
  try {
    const mod = await loadModuleFromEsmSh("is-odd@3.0.1");
    const isOdd = (mod as { default: (n: number) => boolean }).default;

    if (typeof isOdd !== "function") {
      throw new Error(`Expected function, got ${typeof isOdd}`);
    }

    if (isOdd(3) !== true) {
      throw new Error("isOdd(3) should return true");
    }

    if (isOdd(4) !== false) {
      throw new Error("isOdd(4) should return false");
    }

    console.log("✅ Test 2 PASSED: is-odd loaded and works correctly\n");
  } catch (error) {
    console.error(`❌ Test 2 FAILED: ${error instanceof Error ? error.message : error}\n`);
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
