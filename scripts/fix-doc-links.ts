#!/usr/bin/env -S deno run -A
/**
 * Script to automatically fix common broken link patterns in documentation.
 * Run with: deno run -A scripts/fix-doc-links.ts
 *
 * Use --dry-run to preview changes without modifying files.
 */

import { walk } from "std/fs/walk.ts";

const docsRoot = new URL("../docs/", import.meta.url).pathname;
const dryRun = Deno.args.includes("--dry-run");

// Define link replacements: [pattern, replacement]
// These are applied in order
const replacements: Array<[RegExp, string]> = [
  // Fix /docs/... prefix (should just be /...)
  [/\]\(\/docs\/(guides|hooks|components|reference)\//g, "](/"],

  // Fix /guides/ai/... -> /ai/... (AI docs are in docs/ai/, not docs/guides/ai/)
  [/\]\(\/guides\/ai\//g, "](/ai/"],

  // Fix broken /examples/... links to existing examples
  // Map common example references to actual example names
  [/\]\(\/examples\/blog\/\)/g, "](/examples/basic-mdx/)"],
  [/\]\(\/examples\/ecommerce\/\)/g, "](/examples/full-demo/)"],
  [/\]\(\/examples\/e-commerce\/\)/g, "](/examples/full-demo/)"],
  [/\]\(\/examples\/ecommerce-isr\/\)/g, "](/examples/full-demo/)"],
  [/\]\(\/examples\/static-blog\/\)/g, "](/examples/basic-mdx/)"],
  [/\]\(\/examples\/docs\/\)/g, "](/examples/basic-mdx/)"],
  [/\]\(\/examples\/dashboard\/\)/g, "](/examples/full-demo/)"],
  [/\]\(\/examples\/shop\/\)/g, "](/examples/full-demo/)"],
  [/\]\(\/examples\/portfolio\/\)/g, "](/examples/minimal-app-router/)"],
  [/\]\(\/examples\/navigation\/\)/g, "](/examples/minimal-app-router/)"],
  [/\]\(\/examples\/navigation-menu\/\)/g, "](/examples/minimal-app-router/)"],
  [/\]\(\/examples\/search-filters\/\)/g, "](/examples/form-handling/)"],
  [/\]\(\/examples\/multi-step-form\/\)/g, "](/examples/form-handling/)"],
  [/\]\(\/examples\/pagination\/\)/g, "](/examples/data-fetching-demo/)"],
  [/\]\(\/examples\/seo-optimized\/\)/g, "](/examples/basic-mdx/)"],
  [/\]\(\/examples\/image-gallery\/\)/g, "](/examples/full-demo/)"],
  [/\]\(\/examples\/blog-images\/\)/g, "](/examples/basic-mdx/)"],
  [/\]\(\/examples\/news-site\/\)/g, "](/examples/basic-mdx/)"],

  // Fix shorthand paths without .md extension
  [/\]\(\/guides\/routing\/overview\.md\)/g, "](/guides/routing/README.md)"],
  [/\]\(\/guides\/deployment\/node\)/g, "](/guides/deployment/node.md)"],
  [/\]\(\/guides\/performance\/optimization\)/g, "](/guides/performance/optimization.md)"],
  [/\]\(\/guides\/testing\/unit\)/g, "](/guides/testing/unit.md)"],
  [/\]\(\/guides\/testing\/e2e\)/g, "](/guides/testing/e2e.md)"],
  [/\]\(\/guides\/typescript\)/g, "](/guides/troubleshooting/README.md)"],
  [/\]\(\/guides\/styling\/\)/g, "](/guides/components/README.md)"],
  [/\]\(\/guides\/migration\/from-nextjs\.md\)/g, "](/migration/)"],

  // Fix top-level shorthand paths
  [/\]\(\/routing\/\)/g, "](/guides/routing/README.md)"],
  [/\]\(\/rendering\/\)/g, "](/guides/rendering/README.md)"],
  [/\]\(\/data-fetching\/\)/g, "](/reference/functions/README.md)"],
  [/\]\(\/hooks\/overview\)/g, "](/reference/hooks/README.md)"],
  [/\]\(\/components\/overview\)/g, "](/reference/components/README.md)"],
  [/\]\(\/quick-start\.md\)/g, "](/learn/quickstart.md)"],
  [/\]\(\/changelog\.md\)/g, "](/community/changelog.md)"],
  [/\]\(\/examples\/\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples)"],

  // Fix reference functions that don't exist
  [/\]\(\/reference\/functions\/data-fetching\.md\)/g, "](/reference/functions/get-server-data.md)"],
  [/\]\(\/reference\/functions\/revalidation\.md\)/g, "](/reference/functions/get-static-paths.md)"],
  [/\]\(\/reference\/functions\/streaming\.md\)/g, "](/reference/functions/README.md)"],

  // Convert /examples/XXX/ links to GitHub links (examples are outside docs/)
  [/\]\(\/examples\/([\w-]+)\/\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples/$1)"],

  // Fix /performance/... -> /guides/performance/...
  [/\]\(\/performance\/([\w-]+)\.md\)/g, "](/guides/performance/$1.md)"],

  // Fix /deployment/... -> /guides/deployment/...
  [/\]\(\/deployment\/([\w-]+)\.md\)/g, "](/guides/deployment/$1.md)"],

  // Fix shorthand hooks/components paths at root level
  [/\]\(\/(use-[\w-]+)\.md\)/g, "](/reference/hooks/$1.md)"],
  [/\]\(\/(head|link|image|script)\.md\)/g, "](/reference/components/$1.md)"],

  // Fix relative paths that should be absolute
  [/\]\(\.\.\/quick-start\.md\)/g, "](/learn/quickstart.md)"],
  [/\]\(\.\.\/introduction\.md\)/g, "](/learn/introduction.md)"],
  [/\]\(\.\.\/routing\/README\.md\)/g, "](/guides/routing/README.md)"],
  [/\]\(\.\.\/rendering\/README\.md\)/g, "](/guides/rendering/README.md)"],
  [/\]\(\.\.\/rendering\/comparison\.md\)/g, "](/guides/rendering/comparison.md)"],
  [/\]\(\.\.\/rendering\/(ssr|ssg|isr|jit)\.md\)/g, "](/guides/rendering/$1.md)"],

  // Fix ../../routing/... paths
  [/\]\(\.\.\/\.\.\/routing\/([\w-]+)\.md(#[\w-]+)?\)/g, "](/guides/routing/$1.md$2)"],

  // Fix ../guides/... paths
  [/\]\(\.\.\/guides\/([\w-]+)\.md\)/g, "](/guides/$1/README.md)"],

  // Fix ../../src/NAVIGATION.md - remove these broken links
  [/\]\(\.\.\/\.\.\/src\/NAVIGATION\.md\)/g, "](/guides/routing/README.md)"],
  [/\]\(\.\.\/src\/NAVIGATION\.md\)/g, "](/guides/routing/README.md)"],

  // Fix missing local files - convert to closest existing alternatives
  [/\]\(\.\/performance\.md\)/g, "](/guides/performance/README.md)"],
  [/\]\(\.\/authentication\.md\)/g, "](/examples/auth-app)"],
  [/\]\(\.\/building-blog\.md\)/g, "](/examples/basic-mdx)"],
  [/\]\(\.\/custom\.md\)/g, "](./README.md)"],
  [/\]\(\.\/routes\.md\)/g, "](/guides/routing/api-routes.md)"],
  [/\]\(\.\/data-fetching-patterns\.md\)/g, "](/reference/functions/get-server-data.md)"],
  [/\]\(\.\.\/advanced\/architecture\.md(#[\w-]+)?\)/g, "](/guides/architecture/README.md)"],

  // Fix /examples/XXX without trailing slash (GitHub links)
  [/\]\(\/examples\/([\w-]+)\)(?!\))/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples/$1)"],

  // Fix /reference/components/... for script and image (should be without .md or different name)
  [/\]\(\/reference\/components\/script\.md\)/g, "](/guides/components/script.md)"],
  [/\]\(\/reference\/components\/image\.md\)/g, "](/guides/components/image.md)"],

  // Fix relative ./README.md that are pointing to non-existent files
  // These are usually in leaf directories where README.md doesn't exist

  // Fix ../../getting-started/installation.md
  [/\]\(\.\.\/\.\.\/getting-started\/installation\.md\)/g, "](/learn/installation.md)"],
  [/\]\(\.\.\/getting-started\/installation\.md\)/g, "](/learn/installation.md)"],

  // Fix ../../quick-start.md and ../quick-start.md
  [/\]\(\.\.\/\.\.\/quick-start\.md\)/g, "](/learn/quickstart.md)"],

  // Fix ../platform-adapters/overview.md
  [/\]\(\.\.\/platform-adapters\/overview\.md\)/g, "](/guides/adapters/platform/overview.md)"],

  // Fix ../architecture.md
  [/\]\(\.\.\/architecture\.md\)/g, "](/guides/architecture/README.md)"],

  // Fix ../../guides/troubleshooting.md
  [/\]\(\.\.\/\.\.\/guides\/troubleshooting\.md\)/g, "](/guides/troubleshooting/README.md)"],
  [/\]\(\.\.\/guides\/troubleshooting\.md\)/g, "](/guides/troubleshooting/README.md)"],

  // Fix ../../../src/ai/... paths - these reference source code, link to ai docs instead
  [/\]\(\.\.\/\.\.\/\.\.\/src\/ai\/README\.md\)/g, "](/ai/README.md)"],
  [/\]\(\.\.\/\.\.\/\.\.\/src\/ai\/react\/README\.md\)/g, "](/reference/ai/hooks.md)"],
  [/\]\(\.\.\/\.\.\/\.\.\/src\/ai\/react\/components\/README\.md\)/g, "](/reference/ai/README.md)"],
  [/\]\(\.\.\/\.\.\/\.\.\/src\/ai\/react\/primitives\/README\.md\)/g, "](/reference/ai/README.md)"],

  // Fix ..//reference/... (double slash typo)
  [/\]\(\.\.\/\/reference\//g, "](/reference/"],

  // Fix /guides/data-fetching-patterns/README.md
  [/\]\(\/guides\/data-fetching-patterns\/README\.md\)/g, "](/reference/functions/get-server-data.md)"],

  // Many ./XXX.md files don't exist - remove or redirect to closest match
  // These are typically wishlist docs that were never created
  [/\]\(\.\/testing\.md\)/g, "](/guides/testing/README.md)"],
  [/\]\(\.\/static-site\.md\)/g, "](/guides/rendering/ssg.md)"],
  [/\]\(\.\/state-management\.md\)/g, "](/guides/components/README.md)"],
  [/\]\(\.\/seo\.md\)/g, "](/guides/components/head.md)"],
  [/\]\(\.\/security\.md\)/g, "](/guides/middleware/README.md)"],
  [/\]\(\.\/real-time\.md\)/g, "](/guides/routing/api-routes.md)"],
  [/\]\(\.\/multi-tenant\.md\)/g, "](/guides/architecture/README.md)"],
  [/\]\(\.\/microservices\.md\)/g, "](/guides/architecture/README.md)"],
  [/\]\(\.\/mdx\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx)"],
  [/\]\(\.\/error-handling\.md\)/g, "](/reference/functions/not-found.md)"],
  [/\]\(\.\/deployment\/monitoring\.md\)/g, "](/guides/deployment/README.md)"],
  [/\]\(\.\/database\.md\)/g, "](/reference/functions/get-server-data.md)"],
  [/\]\(\.\/data-fetching\.md\)/g, "](/reference/functions/get-server-data.md)"],
  [/\]\(\.\/configuration\.md\)/g, "](/reference/configuration/README.md)"],
  [/\]\(\.\/components\.md\)/g, "](/reference/components/README.md)"],
  [/\]\(\.\/caching\.md\)/g, "](/guides/performance/caching.md)"],
  [/\]\(\.\/writing-docs\.md\)/g, "](/community/contributing.md)"],
  [/\]\(\.\/vscode-setup\.md\)/g, "](/learn/installation.md)"],
  [/\]\(\.\/video\.md\)/g, "](/guides/components/README.md)"],
  [/\]\(\.\/typescript-tips\.md\)/g, "](/guides/troubleshooting/README.md)"],
  [/\]\(\.\/tailwind\.md\)/g, "](/guides/components/README.md)"],
  [/\]\(\.\/styling\/README\.md\)/g, "](/guides/components/README.md)"],
  [/\]\(\.\/styling\.md\)/g, "](/guides/components/README.md)"],
  [/\]\(\.\/social-platform\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples)"],
  [/\]\(\.\/simple-api\.md\)/g, "](/guides/routing/api-routes.md)"],
  [/\]\(\.\/search\.md\)/g, "](/reference/functions/get-server-data.md)"],
  [/\]\(\.\/scaling\.md\)/g, "](/guides/performance/README.md)"],

  // More missing wishlist files
  [/\]\(\.\/rate-limiting\.md\)/g, "](/guides/middleware/README.md)"],
  [/\]\(\.\/project-structure\.md\)/g, "](/learn/project-structure.md)"],
  [/\]\(\.\/pr-guidelines\.md\)/g, "](/community/contributing.md)"],
  [/\]\(\.\/portfolio\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples)"],
  [/\]\(\.\/performance-issues\.md\)/g, "](/guides/performance/README.md)"],
  [/\]\(\.\/payments\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples)"],
  [/\]\(\.\/memory\.md\)/g, "](/ai/README.md)"],
  [/\]\(\.\/local\.md\)/g, "](/guides/adapters/filesystem/overview.md)"],
  [/\]\(\.\/images\.md\)/g, "](/guides/components/image.md)"],
  [/\]\(\.\/image-optimization\.md\)/g, "](/guides/components/image.md)"],
  [/\]\(\.\/hot-reload\.md\)/g, "](/guides/troubleshooting/debugging.md)"],
  [/\]\(\.\/forms\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples/form-handling)"],
  [/\]\(\.\/file-uploads\.md\)/g, "](/guides/routing/api-routes.md)"],
  [/\]\(\.\/env-vars\.md\)/g, "](/reference/configuration/README.md)"],
  [/\]\(\.\/ecommerce\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples)"],
  [/\]\(\.\/docs-site\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples)"],
  [/\]\(\.\/debugging\.md\)/g, "](/guides/troubleshooting/debugging.md)"],
  [/\]\(\.\/dashboard\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples)"],
  [/\]\(\.\/dark-mode\.md\)/g, "](/guides/components/README.md)"],
  [/\]\(\.\/css-modules\.md\)/g, "](/guides/components/README.md)"],
  [/\]\(\.\/css-in-js\.md\)/g, "](/guides/components/README.md)"],
  [/\]\(\.\/cost-optimization\.md\)/g, "](/guides/performance/README.md)"],
  [/\]\(\.\/cors\.md\)/g, "](/guides/middleware/README.md)"],
  [/\]\(\.\/content-collections\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx)"],
  [/\]\(\.\/common-errors\.md\)/g, "](/guides/troubleshooting/README.md)"],
  [/\]\(\.\/code-style\.md\)/g, "](/community/contributing.md)"],
  [/\]\(\.\/code-splitting\.md\)/g, "](/guides/performance/optimization.md)"],
  [/\]\(\.\/bundle-analysis\.md\)/g, "](/guides/performance/optimization.md)"],
  [/\]\(\.\/build-errors\.md\)/g, "](/guides/troubleshooting/README.md)"],
  [/\]\(\.\/background-jobs\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples/async-worker-redis)"],
  [/\]\(\.\/authorization\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples/auth-app)"],

  // Fix ./guides/... relative paths
  [/\]\(\.\/guides\/performance\.md\)/g, "](/guides/performance/README.md)"],
  [/\]\(\.\/guides\/migration\.md\)/g, "](/migration/)"],
  [/\]\(\.\/guides\/images\.md\)/g, "](/guides/components/image.md)"],
  [/\]\(\.\/guides\/deployment\.md\)/g, "](/guides/deployment/README.md)"],
  [/\]\(\.\/guides\/blog\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx)"],

  // Fix ./api/... relative paths
  [/\]\(\.\/api\/routes\.md\)/g, "](/guides/routing/api-routes.md)"],
  [/\]\(\.\/api\/middleware\.md\)/g, "](/guides/middleware/README.md)"],
  [/\]\(\.\/api\/data-fetching\.md\)/g, "](/reference/functions/get-server-data.md)"],
  [/\]\(\.\/api\/configuration\.md\)/g, "](/reference/configuration/README.md)"],
  [/\]\(\.\/api\/components\.md\)/g, "](/reference/components/README.md)"],
  [/\]\(\.\/api\/cli\.md\)/g, "](/reference/cli/README.md)"],

  // Fix ./ai/... relative paths
  [/\]\(\.\/ai\/tools\.md\)/g, "](/reference/ai/tools.md)"],
  [/\]\(\.\/ai\/rag\.md\)/g, "](/ai/README.md)"],
  [/\]\(\.\/ai\/chat\.md\)/g, "](/ai/getting-started.md)"],
  [/\]\(\.\/ai\/agents\.md\)/g, "](/reference/ai/agent.md)"],

  // Fix ./advanced/... relative paths
  [/\]\(\.\/advanced\/security\.md\)/g, "](/guides/middleware/README.md)"],
  [/\]\(\.\/advanced\/observability\.md\)/g, "](/guides/performance/README.md)"],
  [/\]\(\.\/advanced\/custom-builds\.md\)/g, "](/reference/configuration/README.md)"],
  [/\]\(\.\/advanced\/architecture\.md\)/g, "](/guides/architecture/README.md)"],

  // Fix ./platform-adapters/... relative paths
  [/\]\(\.\/platform-adapters\/overview\.md\)/g, "](/guides/adapters/platform/overview.md)"],
  [/\]\(\.\/platform-adapters\/nodejs\.md\)/g, "](/guides/deployment/node.md)"],
  [/\]\(\.\/platform-adapters\/deno\.md\)/g, "](/guides/deployment/deno.md)"],
  [/\]\(\.\/platform-adapters\/cloudflare\.md\)/g, "](/guides/deployment/cloudflare.md)"],
  [/\]\(\.\/platform-adapters\/bun\.md\)/g, "](/guides/deployment/bun.md)"],

  // Fix ./filesystem-adapters/... relative paths
  [/\]\(\.\/filesystem-adapters\/veryfront-api\.md\)/g, "](/guides/adapters/filesystem/veryfront-api.md)"],
  [/\]\(\.\/filesystem-adapters\/overview\.md\)/g, "](/guides/adapters/filesystem/overview.md)"],
  [/\]\(\.\/filesystem-adapters\/local\.md\)/g, "](/guides/adapters/filesystem/overview.md)"],
  [/\]\(\.\/filesystem-adapters\/custom\.md\)/g, "](/guides/adapters/filesystem/overview.md)"],

  // Fix ./deployment/... relative paths
  [/\]\(\.\/deployment\/github-actions\.md\)/g, "](/guides/deployment/README.md)"],
  [/\]\(\.\/deployment\/env-vars\.md\)/g, "](/reference/configuration/README.md)"],
  [/\]\(\.\/deployment\/docker\.md\)/g, "](/guides/deployment/README.md)"],

  // Fix ./migration/... relative paths
  [/\]\(\.\/migration\/remix\.md\)/g, "](/migration/)"],
  [/\]\(\.\/migration\/react\.md\)/g, "](/migration/)"],
  [/\]\(\.\/migration\/nextjs\.md\)/g, "](/migration/)"],
  [/\]\(\.\/migration\/gatsby\.md\)/g, "](/migration/)"],

  // Fix ./community/... relative paths
  [/\]\(\.\/community\/faq\.md\)/g, "](/community/contributing.md)"],
  [/\]\(\.\/community\/examples\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples)"],

  // Fix ./rendering/README.md and ./routing/README.md and ./data-fetching/README.md
  [/\]\(\.\/rendering\/README\.md\)/g, "](/guides/rendering/README.md)"],
  [/\]\(\.\/routing\/README\.md\)/g, "](/guides/routing/README.md)"],
  [/\]\(\.\/data-fetching\/README\.md\)/g, "](/reference/functions/README.md)"],

  // Fix ../routing/... relative paths
  [/\]\(\.\.\/routing\/pages-router\.md\)/g, "](/guides/routing/pages-router.md)"],
  [/\]\(\.\.\/routing\/dynamic-routes\.md\)/g, "](/guides/routing/dynamic-routes.md)"],
  [/\]\(\.\.\/routing\/app-router\.md\)/g, "](/guides/routing/app-router.md)"],
  [/\]\(\.\.\/routing\/api-routes\.md\)/g, "](/guides/routing/api-routes.md)"],

  // Fix ../filesystem-adapters/...
  [/\]\(\.\.\/filesystem-adapters\/overview\.md\)/g, "](/guides/adapters/filesystem/overview.md)"],

  // Fix ../examples/...
  [/\]\(\.\.\/examples\/ai-phase3\/\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples)"],

  // Fix ../debugging.md and ../contributing.md
  [/\]\(\.\.\/debugging\.md\)/g, "](/guides/troubleshooting/debugging.md)"],
  [/\]\(\.\.\/contributing\.md\)/g, "](/community/contributing.md)"],
  [/\]\(\.\.\/community\/contributing\.md\)/g, "](/community/contributing.md)"],

  // Fix ../advanced/custom-adapters.md
  [/\]\(\.\.\/advanced\/custom-adapters\.md\)/g, "](/guides/adapters/README.md)"],

  // Fix ../../rendering/README.md
  [/\]\(\.\.\/\.\.\/rendering\/README\.md\)/g, "](/guides/rendering/README.md)"],

  // Fix ../../../examples/... relative paths (from docs subfolders to examples)
  [/\]\(\.\.\/\.\.\/\.\.\/examples\/([\w-]+)\/README\.md\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples/$1)"],
  [/\]\(\.\.\/\.\.\/\.\.\/examples\/([\w-]+)\/\)/g, "](https://github.com/veryfrontjs/veryfront/tree/main/examples/$1)"],

  // Fix /reference/functions/configuration.md
  [/\]\(\/reference\/functions\/configuration\.md\)/g, "](/reference/configuration/README.md)"],

  // Fix simple runtime names (bun.md, nodejs.md, cloudflare.md) at current directory
  [/\]\(\.\/nodejs\.md\)/g, "](/guides/deployment/node.md)"],
  [/\]\(\.\/bun\.md\)/g, "](/guides/deployment/bun.md)"],
  [/\]\(\.\/cloudflare\.md\)/g, "](/guides/deployment/cloudflare.md)"],
];

let totalChanges = 0;

for await (const entry of walk(docsRoot, { exts: [".md"], includeDirs: false })) {
  const originalText = await Deno.readTextFile(entry.path);
  let newText = originalText;
  let fileChanges = 0;

  for (const [pattern, replacement] of replacements) {
    const matches = newText.match(pattern);
    if (matches) {
      fileChanges += matches.length;
      newText = newText.replace(pattern, replacement);
    }
  }

  if (fileChanges > 0) {
    const relativePath = entry.path.replace(docsRoot, "");
    console.log(`${dryRun ? "[DRY RUN] " : ""}${relativePath}: ${fileChanges} change(s)`);
    totalChanges += fileChanges;

    if (!dryRun) {
      await Deno.writeTextFile(entry.path, newText);
    }
  }
}

console.log(`\n${dryRun ? "[DRY RUN] " : ""}Total: ${totalChanges} change(s) across all files`);

if (dryRun) {
  console.log("\nRun without --dry-run to apply changes.");
}
