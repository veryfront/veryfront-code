/**
 * Build script for publishing Veryfront to npm
 *
 * Uses esbuild + TypeScript to create npm-compatible package with:
 * - ESM output for modern bundlers
 * - TypeScript declaration files
 * - Proper exports map
 *
 * Usage:
 *   deno run -A scripts/build-npm.ts
 *
 * Test locally:
 *   cd npm && npm link
 *   cd /path/to/test-project && npm link veryfront
 */

import * as esbuild from "esbuild/mod.js";
import { createFileSystem, FileSystem } from "../src/platform/compat/fs.ts";
import * as pathHelper from "../src/platform/compat/path-helper.ts";

// Helper to get fs functions (prioritizing the compat layer)
const getFs = (): FileSystem => {
  return createFileSystem();
};

const __dirname = pathHelper.dirname(pathHelper.fromFileUrl(import.meta.url));
const PROJECT_ROOT = pathHelper.resolve(__dirname, "..");
const fs = getFs();

const denoJson = JSON.parse(await fs.readTextFile("./deno.json"));
const version = denoJson.version || "0.0.6";
const denoImports: Record<string, string> = denoJson.imports || {};

const veryfrontImportMap: Record<string, string> = {};
for (const [key, value] of Object.entries(denoImports)) {
	if (
		key.startsWith("@veryfront") &&
		typeof value === "string" &&
		value.startsWith("./")
	) {
		veryfrontImportMap[key] = pathHelper.resolve(PROJECT_ROOT, value);
	}
}

/**
 * Resolve @veryfront/* imports to actual file paths
 */
function resolveVeryfrontImport(importPath: string): string {
	// Direct match
	if (veryfrontImportMap[importPath]) {
		return veryfrontImportMap[importPath];
	}

	// Check prefix matches (e.g., @veryfront/utils/ -> ./src/core/utils/)
	const sortedKeys = Object.keys(veryfrontImportMap)
		.filter((k) => k.endsWith("/"))
		.sort((a, b) => b.length - a.length);

	for (const prefix of sortedKeys) {
		if (importPath.startsWith(prefix.slice(0, -1))) {
			const mappedPrefix = veryfrontImportMap[prefix];
			if (!mappedPrefix) continue;
			const remainder = importPath.slice(prefix.length - 1);
			const resolvedPath = pathHelper.resolve(
				mappedPrefix.replace(/\/$/, ""),
				remainder.replace(/^\//, ""),
			);
			return resolvedPath;
		}
	}

	// Fallback: assume src/<path> structure
	const fallbackPath = pathHelper.resolve(
		PROJECT_ROOT,
		"src",
		importPath.replace("@veryfront/", "").replace("@veryfront", ""),
	);
	return fallbackPath;
}

const OUT_DIR = "./npm";

console.log(`\n📦 Building Veryfront v${version} for npm...\n`);

try {
	await Deno.remove(OUT_DIR, { recursive: true });
} catch {}
await fs.mkdir(OUT_DIR, { recursive: true });
await fs.mkdir(pathHelper.join(OUT_DIR, "dist"), { recursive: true });

const entryPoints: Record<string, string> = {
	"ai/index": "./src/ai/index.ts",
	"ai/client": "./src/ai/client.ts",
	"ai/react": "./src/ai/react/index.ts",
	"ai/primitives": "./src/ai/react/primitives/index.ts",
	"ai/components": "./src/ai/react/components/index.ts",
	"ai/production": "./src/ai/production/index.ts",
	"ai/dev": "./src/ai/dev/index.ts",
	config: "./src/core/config/index.ts",
	data: "./src/data/index.ts",
	components: "./src/react/components/index.ts",
	index: "./src/index.ts",
};

// Import mappings: Deno URLs -> npm packages
// Generated dynamically from deno.json to avoid duplication
const importMappings: Record<string, string> = {};

for (const [key, value] of Object.entries(denoImports)) {
	// Skip local imports (starting with ./ or /)
	if (value.startsWith("./") || value.startsWith("/")) continue;

	// Skip internal @veryfront imports if they point to URLs (unlikely but good safety)
	if (key.startsWith("@veryfront/")) continue;

	// Map the URL (value) to the package name (key)
	importMappings[value] = key;
}

const denoResolvePlugin: esbuild.Plugin = {
	name: "deno-resolve",
	setup(build) {
		build.onResolve({ filter: /^npm:/ }, (args) => {
			const npmPkg = args.path.replace(/^npm:/, "").replace(/@[\d.]+$/, "");
			return { path: npmPkg, external: true };
		});

		build.onResolve({ filter: /^std\// }, (args) => {
			if (args.path.startsWith("std/fmt/colors")) {
				return {
					path: pathHelper.resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts"),
				};
			}

			const stdMappings: Record<string, string> = {
				"std/path": "path",
				"std/path/mod.ts": "path",
				"std/fs": "fs",
				"std/fs/mod.ts": "fs",
				"std/testing/bdd.ts": "@std/testing-bdd",
				"std/expect": "expect",
				"std/front_matter": "gray-matter",
				"std/assert": "assert",
				"std/flags": "minimist",
				"std/flags/mod.ts": "minimist",
				"std/yaml": "yaml",
				"std/yaml/parse.ts": "yaml",
			};
			const mapped = Object.entries(stdMappings).find(([k]) =>
				args.path.startsWith(k),
			);
			if (mapped) {
				return { path: mapped[1], external: true };
			}
			console.warn(`[build-npm] Unmapped std/ import: ${args.path}`);
			return { path: args.path, external: true };
		});

		build.onResolve({ filter: /^https:\/\// }, (args) => {
			if (args.path.includes("deno.land/std")) {
				if (args.path.includes("/path/") || args.path.includes("/path@")) {
					return { path: "path", external: true };
				}
				if (args.path.includes("/fmt/colors")) {
					return {
						path: pathHelper.resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts"),
					};
				}
				if (args.path.includes("/fs/") || args.path.includes("/fs@")) {
					return { path: "fs", external: true };
				}
				if (args.path.includes("/assert/") || args.path.includes("/assert@")) {
					return { path: "assert", external: true };
				}
				if (args.path.includes("/testing/")) {
					return { path: "@std/testing", external: true };
				}
				if (args.path.includes("/front_matter/")) {
					return { path: "gray-matter", external: true };
				}
				if (args.path.includes("/yaml/")) {
					return { path: "yaml", external: true };
				}
				if (args.path.includes("/flags/")) {
					return { path: "minimist", external: true };
				}
				console.warn(`[build-npm] Unmapped Deno std URL: ${args.path}`);
				return { path: "path", external: true };
			}

			const npmPkg = importMappings[args.path];
			if (npmPkg) {
				return { path: npmPkg, external: true };
			}

			const match = args.path.match(/esm\.sh\/(@?[^@/]+(?:\/[^@/]+)?)/);
			if (match) {
				return { path: match[1], external: true };
			}

			const denoXMatch = args.path.match(/deno\.land\/x\/([^@/]+)/);
			if (denoXMatch) {
				console.warn(`[build-npm] Deno third-party import: ${args.path}`);
				return { path: denoXMatch[1], external: true };
			}

			console.warn(`[build-npm] Unknown URL import: ${args.path}`);
			return { path: args.path, external: true };
		});

		build.onResolve({ filter: /^@veryfront/ }, (args) => {
			const importPath = args.path;
			if (veryfrontImportMap[importPath]) {
				return { path: veryfrontImportMap[importPath] };
			}
			const sortedKeys = Object.keys(veryfrontImportMap)
				.filter((k) => k.endsWith("/"))
				.sort((a, b) => b.length - a.length);

			for (const prefix of sortedKeys) {
				if (importPath.startsWith(prefix.slice(0, -1))) {
					const mappedPrefix = veryfrontImportMap[prefix];
					if (!mappedPrefix) continue;
					const remainder = importPath.slice(prefix.length - 1);
					const resolvedPath = pathHelper.resolve(
						mappedPrefix.replace(/\/$/, ""),
						remainder.replace(/^\//, ""),
					);
					return { path: resolvedPath };
				}
			}
			const fallbackPath = pathHelper.resolve(
				PROJECT_ROOT,
				"src",
				importPath.replace("@veryfront/", "").replace("@veryfront", ""),
			);
			return { path: fallbackPath };
		});

		build.onResolve({ filter: /^@std\// }, (args) => {
			const stdMappings: Record<string, string> = {
				"@std/path": "path",
				"@std/fs": "fs",
				"@std/testing/bdd.ts": "@std/testing-bdd",
				"@std/expect": "expect",
			};
			const mapped = Object.entries(stdMappings).find(([k]) =>
				args.path.startsWith(k),
			);
			if (mapped) {
				return { path: mapped[1], external: true };
			}
			return { path: "path", external: true };
		});

		build.onResolve({ filter: /^(react|react-dom|ai|@ai-sdk|zod)/ }, (args) => {
			return { path: args.path, external: true };
		});

		build.onResolve({ filter: /^deno:/ }, () => {
			return { path: "@aspect/deno-shims", external: true };
		});
	},
};

console.log("📝 Pre-bundling client runtime scripts...\n");
const clientBundlePlugin: esbuild.Plugin = {
	name: "client-bundle",
	setup(build) {
		build.onResolve({ filter: /^std\// }, (args) => {
			if (args.path.includes("/fmt/colors")) {
				return {
					path: pathHelper.resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts"),
				};
			}
			if (args.path.includes("/path")) {
				return { path: pathHelper.resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
			}
			return { path: "node:path", external: true };
		});

		build.onResolve({ filter: /^@std\// }, (args) => {
			if (args.path.includes("/path")) {
				return { path: pathHelper.resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
			}
			return { path: "node:path", external: true };
		});

		build.onResolve({ filter: /^@veryfront/ }, (args) => {
			const importPath = args.path;
			if (veryfrontImportMap[importPath]) {
				return { path: veryfrontImportMap[importPath] };
			}
			const sortedKeys = Object.keys(veryfrontImportMap)
				.filter((k) => k.endsWith("/"))
				.sort((a, b) => b.length - a.length);
			for (const prefix of sortedKeys) {
				if (importPath.startsWith(prefix.slice(0, -1))) {
					const mappedPrefix = veryfrontImportMap[prefix];
					if (!mappedPrefix) continue;
					const remainder = importPath.slice(prefix.length - 1);
					const resolvedPath = pathHelper.resolve(
						mappedPrefix.replace(/\/$/, ""),
						remainder.replace(/^\//, ""),
					);
					return { path: resolvedPath };
				}
			}
			const fallbackPath = pathHelper.resolve(
				PROJECT_ROOT,
				"src",
				importPath.replace("@veryfront/", "").replace("@veryfront", ""),
			);
			return { path: fallbackPath };
		});

		build.onResolve({ filter: /^https:\/\// }, (args) => {
			if (
				args.path.includes("deno.land/std") &&
				args.path.includes("/fmt/colors")
			) {
				return {
					path: pathHelper.resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts"),
				};
			}
			const esmMatch = args.path.match(/esm\.sh\/(@?[^@/]+(?:\/[^@/]+)?)/);
			if (esmMatch) return { path: esmMatch[1], external: true };
			return { path: args.path, external: true };
		});

		build.onResolve({ filter: /^(react|react-dom)/ }, (args) => {
			return { path: args.path, external: true };
		});

		build.onResolve({ filter: /^node:/ }, (args) => ({
			path: args.path,
			external: true,
		}));
	},
};

async function prebundleClientScript(
	entryPath: string,
	name: string,
): Promise<string> {
	const result = await esbuild.build({
		entryPoints: [entryPath],
		bundle: true,
		format: "esm",
		platform: "browser",
		target: "es2020",
		write: false,
		sourcemap: false,
		packages: "external",
		mainFields: ["module", "browser", "main"],
		plugins: [clientBundlePlugin],
		external: [
			"react",
			"react-dom",
			"react-dom/client",
			"react/jsx-runtime",
			"react/jsx-dev-runtime",
		],
	});

	const output = result.outputFiles?.[0]?.text;
	if (!output) {
		throw new Error(`Failed to pre-bundle ${name}`);
	}
	return output;
}

let CLIENT_ROUTER_BUNDLE = "";
let CLIENT_PREFETCH_BUNDLE = "";
let CLIENT_DOM_BUNDLE = "";

try {
	CLIENT_ROUTER_BUNDLE = await prebundleClientScript(
		"./src/rendering/client/router.ts",
		"client router",
	);
	console.log(
		`  ✓ Pre-bundled client router: ${(CLIENT_ROUTER_BUNDLE.length / 1024).toFixed(1)} KB`,
	);

	CLIENT_PREFETCH_BUNDLE = await prebundleClientScript(
		"./src/rendering/client/prefetch.ts",
		"client prefetch",
	);
	console.log(
		`  ✓ Pre-bundled client prefetch: ${(CLIENT_PREFETCH_BUNDLE.length / 1024).toFixed(1)} KB`,
	);

	CLIENT_DOM_BUNDLE = await prebundleClientScript(
		"./src/rendering/rsc/client-dom.ts",
		"client dom",
	);
	console.log(
		`  ✓ Pre-bundled client dom: ${(CLIENT_DOM_BUNDLE.length / 1024).toFixed(1)} KB`,
	);

	console.log("  ✓ Generated client bundles (will be injected via plugin)\n");
} catch (error) {
	console.error("  ⚠ Failed to pre-bundle client scripts:", error);
	console.log(
		"  Using empty fallback - client scripts may not work in npm build\n",
	);
}

const templateInjectionPlugin: esbuild.Plugin = {
	name: "template-injection",
	setup(build) {
		build.onLoad({ filter: /templates\.ts$/ }, async (args) => {
			let content = await fs.readTextFile(args.path);

			const routerDecl = `export const CLIENT_ROUTER_BUNDLE: string = ${JSON.stringify(CLIENT_ROUTER_BUNDLE)};`;
			const prefetchDecl = `export const CLIENT_PREFETCH_BUNDLE: string = ${JSON.stringify(CLIENT_PREFETCH_BUNDLE)};`;

			if (content.includes("export let CLIENT_ROUTER_BUNDLE")) {
				content = content.replace(
					/export let CLIENT_ROUTER_BUNDLE[^;]*;/,
					routerDecl,
				);
			} else {
				content = content.replace(
					/export const CLIENT_ROUTER_BUNDLE[\s\S]*?;/,
					routerDecl,
				);
			}

			if (content.includes("export let CLIENT_PREFETCH_BUNDLE")) {
				content = content.replace(
					/export let CLIENT_PREFETCH_BUNDLE[^;]*;/,
					prefetchDecl,
				);
			} else {
				content = content.replace(
					/export const CLIENT_PREFETCH_BUNDLE[\s\S]*?;/,
					prefetchDecl,
				);
			}

			return { contents: content, loader: "ts" };
		});

		// Inject CLIENT_DOM_BUNDLE into script-handlers.ts
		build.onLoad({ filter: /script-handlers\.ts$/ }, async (args) => {
			let content = await fs.readTextFile(args.path);
			const domDecl = `export const CLIENT_DOM_BUNDLE: string = ${JSON.stringify(CLIENT_DOM_BUNDLE)};`;

			if (content.includes("export const CLIENT_DOM_BUNDLE")) {
				content = content.replace(
					/export const CLIENT_DOM_BUNDLE[\s\S]*?;/,
					domDecl,
				);
			}

			return { contents: content, loader: "ts" };
		});
	},
};

console.log("📝 Building ESM modules...\n");

for (const [name, entryPath] of Object.entries(entryPoints)) {
	const outfile = pathHelper.join(OUT_DIR, "dist", `${name}.js`);
	await fs.mkdir(pathHelper.dirname(outfile), { recursive: true });

	console.log(`  Building ${name}...`);

	try {
		await esbuild.build({
			entryPoints: [entryPath],
			outfile,
			bundle: true,
			format: "esm",
			platform: "node",
			target: "esnext",
			sourcemap: true,
			splitting: false,
			treeShaking: true,
			minify: false,
			plugins: [denoResolvePlugin, templateInjectionPlugin],
			supported: {
				"top-level-await": true,
			},
			external: [
				"react",
				"react-dom",
				"react/*",
				"react-dom/*",
				"ai",
				"ai/*",
				"@ai-sdk/*",
				"zod",
				"@mdx-js/*",
				"unified",
				"remark-*",
				"rehype-*",
				"unist-*",
				"mdast-*",
				"hast-*",
				"esbuild",
				"mime-types",
				"github-slugger",
				"picocolors",
				"unocss",
				"@unocss/*",
				"@opentelemetry/*",
				"redis",
				"@redis/*",
				"node:*",
				"fs",
				"fs/*",
				"path",
				"crypto",
				"http",
				"https",
				"stream",
				"stream/*",
				"util",
				"util/*",
				"events",
				"buffer",
				"url",
				"os",
				"child_process",
				"net",
				"tls",
				"zlib",
				"dns",
				"assert",
				"querystring",
				"string_decoder",
				"timers",
				"timers/*",
				"worker_threads",
				"perf_hooks",
				"async_hooks",
				"vm",
				"module",
				"process",
			],
			define: {
				"Deno.env.get": "process.env",
				"Deno.cwd": "process.cwd",
			},
			jsx: "automatic",
			jsxImportSource: "react",
		});
	} catch (error) {
		console.error(`  ❌ Failed to build ${name}:`, error);
	}
}

console.log("\n📝 Building CLI (bundled)...\n");

const cliBundlePlugin: esbuild.Plugin = {
	name: "cli-bundle",
	setup(build) {
		build.onResolve({ filter: /^npm:/ }, (args) => {
			const npmPkg = args.path.replace(/^npm:/, "").replace(/@[\d.]+$/, "");
			return { path: npmPkg, external: true };
		});

		build.onResolve({ filter: /^std\// }, (args) => {
			if (args.path.includes("front_matter")) {
				return {
					path: pathHelper.resolve(PROJECT_ROOT, "src/_shims/std-front-matter.ts"),
				};
			}
			if (args.path.includes("/fs")) {
				return { path: pathHelper.resolve(PROJECT_ROOT, "src/_shims/std-fs.ts") };
			}
			if (args.path.includes("/path")) {
				return { path: pathHelper.resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
			}
			if (args.path.includes("/fmt/colors")) {
				return {
					path: pathHelper.resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts"),
				};
			}
			if (args.path.includes("/flags")) return { path: "mri", external: true };
			if (args.path.includes("/yaml")) return { path: "yaml", external: true };
			if (args.path.includes("/assert"))
				return { path: "node:assert", external: true };
			console.warn(`[cli-bundle] Unmapped std/ import: ${args.path}`);
			return { path: "node:path", external: true };
		});

		build.onResolve({ filter: /^@veryfront/ }, (args) => {
			return { path: resolveVeryfrontImport(args.path) };
		});

		// Handle @std/* imports (Deno standard library with @ prefix)
		build.onResolve({ filter: /^@std\// }, (args) => {
			if (args.path.includes("/path")) {
				return { path: pathHelper.resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
			}
			if (args.path.includes("/fs")) {
				return { path: pathHelper.resolve(PROJECT_ROOT, "src/_shims/std-fs.ts") };
			}
			if (args.path.includes("/front_matter")) {
				return {
					path: pathHelper.resolve(PROJECT_ROOT, "src/_shims/std-front-matter.ts"),
				};
			}
			if (args.path.includes("/fmt/colors")) {
				return {
					path: pathHelper.resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts"),
				};
			}
			if (args.path.includes("/yaml")) return { path: "yaml", external: true };
			if (args.path.includes("/assert"))
				return { path: "node:assert", external: true };
			if (args.path.includes("/testing"))
				return { path: "@std/testing", external: true };
			console.warn(`[cli-bundle] Unmapped @std/ import: ${args.path}`);
			return { path: "node:path", external: true };
		});

		build.onResolve({ filter: /^https:\/\// }, (args) => {
			if (args.path.includes("deno.land/x/esbuild"))
				return { path: "esbuild", external: true };
			if (args.path.includes("deno.land/std")) {
				if (args.path.includes("/path")) {
					return { path: pathHelper.resolve(PROJECT_ROOT, "src/_shims/std-path.ts") };
				}
				if (args.path.includes("/fs")) {
					return { path: pathHelper.resolve(PROJECT_ROOT, "src/_shims/std-fs.ts") };
				}
				if (args.path.includes("/fmt/colors")) {
					return {
						path: pathHelper.resolve(PROJECT_ROOT, "src/platform/compat/console/ansi.ts"),
					};
				}
				if (args.path.includes("/front_matter")) {
					return {
						path: pathHelper.resolve(PROJECT_ROOT, "src/_shims/std-front-matter.ts"),
					};
				}
				if (args.path.includes("/assert"))
					return { path: "node:assert", external: true };
				return { path: "node:path", external: true };
			}
			const esmMatch = args.path.match(/esm\.sh\/(@?[^@/]+(?:\/[^@/]+)?)/);
			if (esmMatch) {
				const pkgName = esmMatch[1];
				// Bundle these packages instead of externalizing them
				// These need to be bundled because npx doesn't always install dependencies properly
				const packagesToBundlePatterns = [
					"rehype-", "remark-", "unified", "github-slugger",
					"unist-", "mdast-", "hast-", "@unocss/", "unocss",
					"@mdx-js/", "lightningcss", "mime-types",
				];
				const shouldBundle = packagesToBundlePatterns.some(pattern =>
					pkgName?.startsWith(pattern) || pkgName === pattern
				);
				if (shouldBundle) {
					// Use http-url namespace to fetch and bundle these packages
					return { path: args.path, namespace: "http-url" };
				}
				return { path: pkgName, external: true };
			}
			return { path: args.path, external: true };
		});

		build.onResolve({ filter: /^node:/ }, (args) => ({
			path: args.path,
			external: true,
		}));

		build.onResolve({ filter: /^esbuild/ }, () => ({
			path: "esbuild",
			external: true,
		}));

		build.onResolve(
			{
				filter:
					/^(react|react-dom|zod|ai|@ai-sdk|picocolors|mri|yaml|gray-matter|ws)/,
			},
			(args) => {
				return { path: args.path, external: true };
			},
		);

		// Handle bare imports that need to be resolved to esm.sh URLs for bundling
		// These are packages that Deno resolves via import map but esbuild doesn't know about
		const bareImportMap: Record<string, string> = {
			"@unocss/core": "https://esm.sh/@unocss/core@0.59.0",
			"@unocss/preset-wind": "https://esm.sh/@unocss/preset-wind@0.59.0",
			"rehype-highlight": "https://esm.sh/rehype-highlight@7.0.2",
			"rehype-slug": "https://esm.sh/rehype-slug@6.0.0",
			"remark-gfm": "https://esm.sh/remark-gfm@4.0.1",
			"remark-frontmatter": "https://esm.sh/remark-frontmatter@5.0.0",
			"unified": "https://esm.sh/unified@11.0.5",
			"github-slugger": "https://esm.sh/github-slugger@2.0.0",
			"unist-util-visit": "https://esm.sh/unist-util-visit@5.0.0",
			"mdast-util-to-string": "https://esm.sh/mdast-util-to-string@4.0.0",
			"@mdx-js/mdx": "https://esm.sh/@mdx-js/mdx@3.0.0",
			"@mdx-js/react": "https://esm.sh/@mdx-js/react@3.0.0",
			"mime-types": "https://esm.sh/mime-types@2.1.35",
			"lightningcss": "https://esm.sh/lightningcss@1.22.0",
		};

		build.onResolve(
			{
				filter: /^(@unocss\/|rehype-|remark-|unified|github-slugger|unist-|mdast-|@mdx-js\/|mime-types|lightningcss)/,
			},
			(args) => {
				const esmUrl = bareImportMap[args.path];
				if (esmUrl) {
					// Use http-url namespace so esbuild knows this isn't a file path
					return { path: esmUrl, namespace: "http-url" };
				}
				// For prefix matches like unist-util-visit, remark-xxx etc, externalize them
				return { path: args.path, external: true };
			},
		);

		// Handle transitive URL imports within http-url namespace
		// This covers both absolute URLs (https://...) and root-relative paths (/...)
		build.onResolve(
			{ filter: /.*/, namespace: "http-url" },
			(args) => {
				// If it's already an absolute URL, use it directly
				if (args.path.startsWith("https://") || args.path.startsWith("http://")) {
					return { path: args.path, namespace: "http-url" };
				}
				// esm.sh uses root-relative paths like /@unocss/core@0.59.0/denonext/core.mjs
				// Convert them to full URLs
				if (args.path.startsWith("/")) {
					const fullUrl = `https://esm.sh${args.path}`;
					return { path: fullUrl, namespace: "http-url" };
				}
				// For relative paths, resolve against the importer
				if (args.importer && args.importer.startsWith("https://")) {
					const resolvedUrl = new URL(args.path, args.importer).href;
					return { path: resolvedUrl, namespace: "http-url" };
				}
				// Externalize anything else we can't resolve
				return { path: args.path, external: true };
			},
		);

		// Fetch and load HTTP URLs
		build.onLoad(
			{ filter: /.*/, namespace: "http-url" },
			async (args) => {
				console.log(`  Fetching: ${args.path}`);
				const response = await fetch(args.path);
				if (!response.ok) {
					throw new Error(`Failed to fetch ${args.path}: ${response.status}`);
				}
				const contents = await response.text();
				return {
					contents,
					loader: "js",
					resolveDir: PROJECT_ROOT,
				};
			},
		);
	},
};

try {
	await esbuild.build({
		entryPoints: ["./src/cli/index/cli-main.ts"],
		outfile: pathHelper.join(OUT_DIR, "dist", "cli.js"),
		bundle: true,
		format: "esm",
		platform: "node",
		target: "esnext",
		sourcemap: false,
		plugins: [cliBundlePlugin, templateInjectionPlugin],
		supported: { "top-level-await": true },
		external: [
			"react",
			"react-dom",
			"react/*",
			"react-dom/*",
			"ai",
			"ai/*",
			"@ai-sdk/*",
			// Note: @mdx-js/*, @unocss/*, mime-types, github-slugger, lightningcss
			// are now bundled via http-url namespace to ensure npx compatibility
			"esbuild",
			"picocolors",
			"mri",
			"yaml",
			"gray-matter",
			"@opentelemetry/*",
			"node:*",
			"glob",
		],
		jsx: "automatic",
					jsxImportSource: "react",
				});
				const stat = await fs.stat(pathHelper.join(OUT_DIR, "dist", "cli.js"));
				console.log(
					`  ✓ Built CLI bundle: ${(stat.size / 1024).toFixed(1)} KB (single file)`,
				);} catch (error) {
	console.error("  ❌ Failed to build CLI bundle:", error);
}

console.log("\n📝 Generating TypeScript declarations...\n");

// Generate declaration files using deno doc --json and transform to .d.ts
// For now, we'll generate ambient declarations that export the public API

const declarationFiles: Record<string, string> = {
	"index.d.ts": `// Type definitions for veryfront
// Main exports from veryfront

export { Head, Link, Script, Image } from './components';
export type { HeadProps, LinkProps, ScriptProps, ImageProps } from './components';

// Re-export data utilities
export * from './data';

// Re-export config utilities
export * from './config';
`,

	"components.d.ts": `// Component type definitions
import type { ReactNode, HTMLAttributes, AnchorHTMLAttributes, ScriptHTMLAttributes, ImgHTMLAttributes } from 'react';

export interface HeadProps {
  children?: ReactNode;
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  children?: ReactNode;
}

export interface ScriptProps extends ScriptHTMLAttributes<HTMLScriptElement> {
  src?: string;
  strategy?: 'beforeInteractive' | 'afterInteractive' | 'lazyOnload';
}

export interface ImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
  placeholder?: 'blur' | 'empty';
}

export declare function Head(props: HeadProps): JSX.Element;
export declare function Link(props: LinkProps): JSX.Element;
export declare function Script(props: ScriptProps): JSX.Element;
export declare function Image(props: ImageProps): JSX.Element;
`,

	"data.d.ts": `// Data utilities type definitions
export interface DataContext {
  params: Record<string, string>;
  searchParams: URLSearchParams;
  request: Request;
}

export interface GetServerDataResult<T> {
  props: T;
  revalidate?: number;
  notFound?: boolean;
  redirect?: { destination: string; permanent?: boolean };
}

export type GetServerData<T = Record<string, unknown>> = (
  ctx: DataContext
) => Promise<GetServerDataResult<T>> | GetServerDataResult<T>;

export declare function notFound(): never;
export declare function redirect(url: string, status?: number): never;
export declare function json<T>(data: T, init?: ResponseInit): Response;
`,

	"config.d.ts": `// Configuration type definitions
export interface VeryFrontConfig {
  title?: string;
  description?: string;
  runtime?: 'deno' | 'node' | 'bun' | 'cloudflare';
  dev?: {
    port?: number;
    hmr?: boolean;
  };
  build?: {
    outDir?: string;
    minify?: boolean;
  };
  ai?: {
    enabled?: boolean;
    providers?: {
      openai?: { apiKey?: string };
      anthropic?: { apiKey?: string };
    };
  };
}

export declare function defineConfig(config: VeryFrontConfig): VeryFrontConfig;
`,

	"ai/index.d.ts": `// AI module type definitions
import type { z } from 'zod';

export interface AgentConfig {
  model: string;
  system?: string;
  tools?: Record<string, boolean | object>;
  memory?: {
    type?: 'conversation' | 'summary' | 'buffer';
    maxTokens?: number;
  };
  maxSteps?: number;
  temperature?: number;
}

export interface ToolConfig<TInput = unknown, TOutput = unknown> {
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<TOutput> | TOutput;
}

export interface ResourceConfig<TParams = unknown, TData = unknown> {
  description: string;
  paramsSchema?: z.ZodType<TParams>;
  load: (params: TParams) => Promise<TData> | TData;
}

export declare function agent(config: AgentConfig): {
  stream(options: { messages: Array<{ role: string; content: string }> }): {
    toDataStreamResponse(): Response;
  };
  respond(request: Request): Promise<Response>;
};

export declare function tool<TInput, TOutput>(config: ToolConfig<TInput, TOutput>): ToolConfig<TInput, TOutput>;

export declare function resource<TParams, TData>(config: ResourceConfig<TParams, TData>): ResourceConfig<TParams, TData>;

// Re-export from ai-sdk
export * from 'ai';
`,

	"ai/client.d.ts": `// AI client type definitions
export * from 'ai';
`,

	"ai/react.d.ts": `// AI React hooks type definitions
import type { Message } from 'ai';
import type { ReactNode, ChangeEvent, FormEvent } from 'react';

// UseChat Types
export interface UseChatOptions {
  api: string;
  initialMessages?: Message[];
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  onResponse?: (response: Response) => void;
  onFinish?: (message: Message) => void;
  onError?: (error: Error) => void;
}

export interface UseChatResult {
  messages: Message[];
  input: string;
  isLoading: boolean;
  error: Error | null;
  setInput: (input: string) => void;
  append: (message: Omit<Message, "id" | "timestamp">) => Promise<void>;
  reload: () => Promise<void>;
  stop: () => void;
  setMessages: (messages: Message[]) => void;
  data?: unknown;
  handleInputChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleSubmit: (e: FormEvent) => Promise<void>;
}

export declare function useChat(options: UseChatOptions): UseChatResult;

// UseCompletion Types
export interface UseCompletionOptions {
  api: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  onResponse?: (response: Response) => void;
  onFinish?: (completion: string) => void;
  onError?: (error: Error) => void;
}

export interface UseCompletionResult {
  completion: string;
  isLoading: boolean;
  error: Error | null;
  complete: (prompt: string) => Promise<void>;
  stop: () => void;
  setCompletion: (completion: string) => void;
}

export declare function useCompletion(options: UseCompletionOptions): UseCompletionResult;

// UseAgent Types (Custom)
export type AgentStatus = "idle" | "thinking" | "executing" | "completed" | "error";

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
  status: "pending" | "executing" | "completed" | "error";
  result?: unknown;
  error?: string;
}

export interface UseAgentOptions {
  agent: string;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (toolCall: ToolCall, result: unknown) => void;
  onError?: (error: Error) => void;
}

export interface UseAgentResult {
  messages: Message[];
  toolCalls: ToolCall[];
  status: AgentStatus;
  thinking?: string;
  invoke: (input: string) => Promise<void>;
  stop: () => void;
  isLoading: boolean;
  error: Error | null;
}

export declare function useAgent(options: UseAgentOptions): UseAgentResult;

// UseStreaming Types
export interface UseStreamingOptions {
  url: string;
  onChunk?: (chunk: string) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

export interface UseStreamingResult {
  data: string;
  isStreaming: boolean;
  error: Error | null;
  start: (body?: Record<string, unknown>) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export declare function useStreaming(options: UseStreamingOptions): UseStreamingResult;
`,

	"ai/primitives.d.ts": `// AI primitive components type definitions
import type { ReactNode, HTMLAttributes } from 'react';
import type { UseChatHelpers } from '@ai-sdk/react';

export interface ChatContainerProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export interface MessageListProps extends HTMLAttributes<HTMLDivElement> {
  messages: Array<{ id: string; role: string; content: string }>;
  renderMessage?: (message: { id: string; role: string; content: string }) => ReactNode;
}

export interface MessageItemProps extends HTMLAttributes<HTMLDivElement> {
  message: { id: string; role: string; content: string };
}

export interface InputFormProps extends HTMLAttributes<HTMLFormElement> {
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading?: boolean;
  placeholder?: string;
}

export declare function ChatContainer(props: ChatContainerProps): JSX.Element;
export declare function MessageList(props: MessageListProps): JSX.Element;
export declare function MessageItem(props: MessageItemProps): JSX.Element;
export declare function InputForm(props: InputFormProps): JSX.Element;
`,

	"ai/components.d.ts": `// AI styled components type definitions
import type { ReactNode, HTMLAttributes } from 'react';
import type { UseChatHelpers } from '@ai-sdk/react';

export interface ChatProps extends Partial<UseChatHelpers> {
  className?: string;
  placeholder?: string;
  welcomeMessage?: string;
}

export declare function Chat(props: ChatProps): JSX.Element;
`,

	"ai/production.d.ts": `// AI production utilities type definitions
export interface RateLimitConfig {
  windowMs?: number;
  maxRequests?: number;
}

export interface CostTrackingConfig {
  enabled?: boolean;
  budgetLimit?: number;
}

export declare function withRateLimit(config: RateLimitConfig): (handler: (req: Request) => Promise<Response>) => (req: Request) => Promise<Response>;
export declare function withCostTracking(config: CostTrackingConfig): (handler: (req: Request) => Promise<Response>) => (req: Request) => Promise<Response>;
`,

	"ai/dev.d.ts": `// AI development utilities type definitions
export interface DevToolsConfig {
  enabled?: boolean;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

export declare function AIDevTools(props: DevToolsConfig): JSX.Element | null;
`,
};

// Write all declaration files
for (const [filename, content] of Object.entries(declarationFiles)) {
	const dtsPath = pathHelper.join(OUT_DIR, "dist", filename);
	await fs.mkdir(pathHelper.dirname(dtsPath), { recursive: true });
	await fs.writeTextFile(dtsPath, content);
	console.log(`  ✓ Generated ${filename}`);
}

console.log("\n📄 Generating package.json...");

const packageJson = {
	name: "veryfront",
	version,
	description:
		"Zero-config React meta-framework for building agentic AI applications",
	type: "module",
	main: "./dist/index.js",
	module: "./dist/index.js",
	types: "./dist/index.d.ts",
	bin: {
		veryfront: "./bin/veryfront.js",
	},
	exports: {
		".": {
			types: "./dist/index.d.ts",
			import: "./dist/index.js",
		},
		"./components": {
			types: "./dist/components.d.ts",
			import: "./dist/components.js",
		},
		"./data": {
			types: "./dist/data.d.ts",
			import: "./dist/data.js",
		},
		"./config": {
			types: "./dist/config.d.ts",
			import: "./dist/config.js",
		},
		"./ai": {
			types: "./dist/ai/index.d.ts",
			import: "./dist/ai/index.js",
		},
		"./ai/client": {
			types: "./dist/ai/client.d.ts",
			import: "./dist/ai/client.js",
		},
		"./ai/react": {
			types: "./dist/ai/react.d.ts",
			import: "./dist/ai/react.js",
		},
		"./ai/primitives": {
			types: "./dist/ai/primitives.d.ts",
			import: "./dist/ai/primitives.js",
		},
		"./ai/components": {
			types: "./dist/ai/components.d.ts",
			import: "./dist/ai/components.js",
		},
		"./ai/production": {
			types: "./dist/ai/production.d.ts",
			import: "./dist/ai/production.js",
		},
		"./ai/dev": {
			types: "./dist/ai/dev.d.ts",
			import: "./dist/ai/dev.js",
		},
	},
	files: ["bin", "dist", "README.md", "LICENSE"],
	keywords: [
		"react",
		"framework",
		"ai",
		"agents",
		"mcp",
		"llm",
		"anthropic",
		"openai",
		"ssr",
		"rsc",
		"server-components",
		"typescript",
	],
	license: "MIT",
	author: "Veryfront",
	repository: {
		type: "git",
		url: "git+https://github.com/veryfront/veryfront.git",
	},
	bugs: {
		url: "https://github.com/veryfront/veryfront/issues",
	},
	homepage: "https://veryfront.com",
	engines: {
		node: ">=18.0.0",
	},
	peerDependencies: {
		react: "^17.0.0 || ^18.0.0 || ^19.0.0",
		"react-dom": "^17.0.0 || ^18.0.0 || ^19.0.0",
		zod: "^3.22.0",
		ai: "^5.0.0",
	},
	peerDependenciesMeta: {
		zod: { optional: false },
		ai: { optional: false },
	},
	dependencies: {
		"@ai-sdk/openai": "^2.0.0",
		"@ai-sdk/anthropic": "^2.0.0",
		"@ai-sdk/react": "^2.0.0",
		esbuild: "^0.20.0",
		"@mdx-js/mdx": "^3.0.0",
		"@mdx-js/react": "^3.0.0",
		"mime-types": "^2.1.35",
		unified: "^11.0.0",
		"remark-gfm": "^4.0.0",
		"remark-frontmatter": "^5.0.0",
		"rehype-highlight": "^7.0.0",
		"rehype-slug": "^6.0.0",
		"github-slugger": "^2.0.0",
		picocolors: "^1.1.0",
		mri: "^1.2.0",
		yaml: "^2.3.0",
		"gray-matter": "^4.0.3",
		ws: "^8.18.0",
		lightningcss: "^1.22.0",
		"@unocss/core": "^0.59.0",
		"@unocss/preset-wind": "^0.59.0",
		glob: "^11.0.0",
	},
	devDependencies: {
		"@types/react": "^18.2.0",
		"@types/react-dom": "^18.2.0",
		"@types/node": "^20.0.0",
		typescript: "^5.0.0",
	},
};

await fs.writeTextFile(
	pathHelper.join(OUT_DIR, "package.json"),
	JSON.stringify(packageJson, null, 2),
);

console.log("📄 Creating CLI bin wrapper...");
await fs.mkdir(pathHelper.join(OUT_DIR, "bin"), { recursive: true });
const cliBinContent = `#!/usr/bin/env node
// CLI entry point - calls main() from the bundled CLI
import { main } from '../dist/cli.js';
main().catch(err => {
  console.error(err);
  process.exit(1);
});
`;
const binPath = pathHelper.join(OUT_DIR, "bin", "veryfront.js");
await fs.writeTextFile(binPath, cliBinContent);

// Make the bin file executable (Deno only)
// @ts-ignore - Deno global
if (typeof Deno !== 'undefined') {
  // @ts-ignore - Deno global
  await Deno.chmod(binPath, 0o755);
}

console.log("📄 Copying additional files...");
try {
  // @ts-ignore - Deno global
  await Deno.copyFile("README.md", pathHelper.join(OUT_DIR, "README.md"));
} catch {
	console.log("  No README.md found");
}
try {
  // @ts-ignore - Deno global
  await Deno.copyFile("LICENSE", pathHelper.join(OUT_DIR, "LICENSE"));
} catch {
	console.log("  No LICENSE found, creating MIT license...");
	await fs.writeTextFile(
		pathHelper.join(OUT_DIR, "LICENSE"),
		`MIT License\n\nCopyright (c) ${new Date().getFullYear()} Veryfront\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`,
	);
}

esbuild.stop();

console.log(`
✅ Build complete!

📦 Output: ${OUT_DIR}/

📋 Test locally:
   cd npm && npm link

   # In a test project:
   npm link veryfront

   # Test CLI:
   npx veryfront --help

📋 Publish:
   cd npm && npm publish
`);
