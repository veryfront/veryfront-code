// Test the FSAdapter path normalization for shared/ui
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

console.log("\n=== Testing shared/ui resolution ===");

// Test various paths
const testPaths = [
  "/private/tmp/veryfront-fs-test/shared/ui/Container.tsx",
  "/private/tmp/veryfront-fs-test/shared/ui/Container",
  "/private/tmp/veryfront-fs-test/shared",
  "/private/tmp/veryfront-fs-test/features",
];

for (const path of testPaths) {
  console.log("\nTesting:", path);
  try {
    const stat = await adapter.stat(path);
    console.log("  Stat:", stat.isFile ? "FILE" : stat.isDirectory ? "DIR" : "OTHER");
  } catch (e) {
    console.log("  Error:", String(e).split("\n")[0]);
  }

  try {
    const exists = await adapter.exists(path);
    console.log("  Exists:", exists);
  } catch (e) {
    console.log("  Exists error:", String(e).split("\n")[0]);
  }
}

// List shared/ui directory
console.log("\n=== Listing shared/ui directory ===");
try {
  const entries = await adapter.readdir("/private/tmp/veryfront-fs-test/shared/ui");
  console.log("Entries:", entries.length);
  for (const e of entries.slice(0, 10)) {
    console.log("  -", e.name, e.isDirectory ? "(dir)" : "(file)");
  }
} catch (e) {
  console.log("Error:", String(e).split("\n")[0]);
}
