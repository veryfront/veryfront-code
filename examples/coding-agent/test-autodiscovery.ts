/**
 * Test Autodiscovery
 *
 * Verify that tools are automatically discovered from ai/tools/ directory
 */

import { discoverAll, getMCPStats } from "../../src/ai/index.ts";

console.log("=== Testing Veryfront AI Autodiscovery ===\n");

// Discover all AI components
const result = await discoverAll({
  baseDir: new URL(".", import.meta.url).pathname,
  aiDir: "ai",
  verbose: true,
});

console.log("\n=== Discovery Results ===");
console.log(`✅ Tools discovered: ${result.tools.size}`);
console.log(`✅ Agents discovered: ${result.agents.size}`);
console.log(`✅ Resources discovered: ${result.resources.size}`);
console.log(`✅ Prompts discovered: ${result.prompts.size}`);

if (result.errors.length > 0) {
  console.log(`\n❌ Errors: ${result.errors.length}`);
  result.errors.forEach((e) => {
    console.log(`  - ${e.file}: ${e.error.message}`);
  });
}

// Show discovered tools
console.log("\n=== Discovered Tools ===");
for (const [id, tool] of result.tools.entries()) {
  console.log(`  ✓ ${id}`);
  console.log(`    Description: ${tool.description}`);
}

// Show MCP registry stats
const stats = getMCPStats();
console.log("\n=== MCP Registry Stats ===");
console.log(`  Tools: ${stats.tools}`);
console.log(`  Resources: ${stats.resources}`);
console.log(`  Prompts: ${stats.prompts}`);
console.log(`  Total: ${stats.total}`);

console.log("\n=== Autodiscovery Test Complete ===");

// Verify expected tools were discovered
const expectedTools = ["readFile", "writeFile", "listFiles", "webSearch"];
const discoveredTools = Array.from(result.tools.keys());
const allFound = expectedTools.every((tool) => discoveredTools.includes(tool));

if (allFound) {
  console.log("\n✅ SUCCESS: All expected tools were discovered!");
  console.log(`   Expected: ${expectedTools.join(", ")}`);
  console.log(`   Found: ${discoveredTools.join(", ")}`);
} else {
  console.log("\n❌ FAILED: Some tools were not discovered");
  console.log(`   Expected: ${expectedTools.join(", ")}`);
  console.log(`   Found: ${discoveredTools.join(", ")}`);
  Deno.exit(1);
}
