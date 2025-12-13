// Test the FSAdapter path normalization
import { VeryfrontFSAdapter } from "./src/platform/adapters/veryfront-fs-adapter.ts";

const adapter = new VeryfrontFSAdapter({
  type: "veryfront-api",
  veryfront: {
    baseUrl: "https://api.veryfront.com/api",
    apiToken: "vf_25f59938_f9f07f7065ac733a07be0d6a1dca94be",
    projectSlug: "veryfront"
  },
  projectDir: "/private/tmp/veryfront-fs-test"
});

await adapter.initialize();

console.log("\n=== Testing path normalization ===");

// Test readdir on pages directory
const pagesPath = "/private/tmp/veryfront-fs-test/pages";
console.log("\nReading directory:", pagesPath);
try {
  const entries = await adapter.readdir(pagesPath);
  console.log("Found entries:", entries.length);
  for (const e of entries.slice(0, 10)) {
    console.log("  -", e.name, e.isDirectory ? "(dir)" : "(file)");
  }
  if (entries.length > 10) console.log("  ... and", entries.length - 10, "more");
} catch (e) {
  console.error("Error:", e);
}

// Test stat on index.mdx
const indexPath = "/private/tmp/veryfront-fs-test/pages/index.mdx";
console.log("\nStat:", indexPath);
try {
  const stat = await adapter.stat(indexPath);
  console.log("Stat result:", stat);
} catch (e) {
  console.error("Error:", e);
}

// Test exists
console.log("\nExists:", indexPath);
try {
  const exists = await adapter.exists(indexPath);
  console.log("Exists:", exists);
} catch (e) {
  console.error("Error:", e);
}

// Test reading the file
console.log("\nReading file:", indexPath);
try {
  const content = await adapter.readTextFile(indexPath);
  console.log("Content length:", content.length);
  console.log("First 200 chars:", content.slice(0, 200));
} catch (e) {
  console.error("Error:", e);
}
