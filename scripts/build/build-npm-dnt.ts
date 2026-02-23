/**
 * Build script for publishing Veryfront to npm using dnt
 *
 * Much simpler than the esbuild-based approach - dnt handles:
 * - Deno → Node module transformation
 * - TypeScript declarations
 * - Import map resolution
 * - Shims for Deno APIs
 *
 * Usage:
 *   deno run -A scripts/build-npm-dnt.ts
 */

import { build, emptyDir } from "jsr:@deno/dnt";

const denoJson = JSON.parse(await Deno.readTextFile("./deno.json"));
const version = denoJson.version;
if (!version) {
	throw new Error("deno.json must have a 'version' field");
}
const license = denoJson.license;
if (!license) {
	throw new Error("deno.json must have a 'license' field");
}

console.log(`\n📦 Building Veryfront v${version} for npm using dnt...\n`);

// Generate templates manifest before build
console.log("📝 Generating templates manifest...");
const genManifest = new Deno.Command("deno", {
	args: ["run", "-A", "scripts/build/generate-templates-manifest.ts"],
	stdout: "inherit",
	stderr: "inherit",
});
const { code: manifestCode } = await genManifest.output();
if (manifestCode !== 0) {
	throw new Error("Failed to generate templates manifest");
}

await emptyDir("./npm");

// Convert deno.json exports to dnt entry points
const entryPoints = Object.entries(denoJson.exports as Record<string, string>)
	.map(([name, path]) => ({ name, path }));

// Auto-derive esm.sh URL mappings from deno.json imports so versions stay in sync.
// dnt ignores mappings it doesn't encounter, so including all is safe.
const esmShMappings = buildEsmShMappings(denoJson.imports as Record<string, string>);

await build({
	entryPoints,
	outDir: "./npm",

	// Don't run tests during build (they're Deno-specific)
	test: false,

	// ESM only (no CommonJS) - allows top-level await
	scriptModule: false,

	// Skip type checking - runtime compatibility is verified by Deno's type checker
	// dnt's Node type environment differs significantly from Deno's web-standard types
	typeCheck: false,

	// Skip npm install - we run it manually with --legacy-peer-deps to avoid peer dep conflicts
	skipNpmInstall: true,

	// Package metadata
	shims: {
		deno: true,
		timers: true,
		crypto: true,
		blob: true,
		undici: true,
	},

	// Compiler options for declaration generation
	compilerOptions: {
		lib: ["ES2022", "DOM", "DOM.Iterable"],
		target: "ES2022",
		skipLibCheck: true,
	},

	// Map Deno std and type packages to npm equivalents
	mappings: {
		// Type-only packages - map to @types versions
		"npm:@types/mdast@4.0.3": {
			name: "@types/mdast",
			version: "^4.0.3",
		},
		"npm:@types/hast@3.0.3": {
			name: "@types/hast",
			version: "^3.0.3",
		},
		"npm:@types/unist@3.0.2": {
			name: "@types/unist",
			version: "^3.0.2",
		},
		// esm.sh URLs - derived from deno.json imports
		...esmShMappings,
	},

	package: {
		name: "veryfront",
		version,
		description: "The simplest way to build AI-powered apps",
		license,
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
		// dnt can't detect dynamic imports, so we add them explicitly
		dependencies: {
			"@types/react": "^19.0.0",
			"@types/react-dom": "^19.0.0",
			"ws": "^8.18.0",
		},
		// Native binary deps that should not block install if they fail
		optionalDependencies: {
			"@huggingface/transformers": "^3.4.2",
		},
		keywords: [
			"react",
			"framework",
			"ai",
			"agents",
			"mcp",
			"llm",
			"ssr",
			"rsc",
			"typescript",
		],
		// Optional peer dependencies for platform-specific features
		peerDependencies: {
			"better-sqlite3": ">=9.0.0",
		},
		peerDependenciesMeta: {
			"better-sqlite3": { optional: true },
		},
		devDependencies: {
			"@types/ws": "^8.5.0",
			"@types/better-sqlite3": "^7.6.0",
			"@types/mime-types": "^2.1.0",
		},
		// postinstall added in postBuild after files are copied
	},

	// Post-build steps
	async postBuild() {
		// Run npm install with --legacy-peer-deps to avoid peer dep conflicts
		// (e.g., @ai-sdk/react requires react ~19.1.2 but framework uses 19.1.1)
		const npmInstall = new Deno.Command("npm", {
			args: ["install", "--legacy-peer-deps"],
			cwd: "./npm",
			stdout: "inherit",
			stderr: "inherit",
		});
		const { code } = await npmInstall.output();
		if (code !== 0) {
			throw new Error(`npm install failed with exit code ${code}`);
		}

		// Copy RSC client files that are read at runtime (not imported as modules).
		// script-handlers.ts resolves these relative to import.meta.url.
		const rscClientFiles = ["client-boot.ts", "client-dom.ts", "client-hydrator.ts", "hydrate-client.ts"];
		const rscSrc = "./src/rendering/rsc";
		const rscDest = "./npm/esm/src/rendering/rsc";
		await Deno.mkdir(rscDest, { recursive: true });
		for (const file of rscClientFiles) {
			await Deno.copyFile(`${rscSrc}/${file}`, `${rscDest}/${file}`);
		}
		console.log(`📝 Copied ${rscClientFiles.length} RSC client files`);

		// Fix dnt polyfill bug: process.argv[1] can be undefined in dynamic imports
		patchFile(
			"./npm/esm/_dnt.polyfills.js",
			'process.argv[1].replace',
			'(process.argv[1] ?? "").replace',
			"dnt polyfill process.argv[1] fix",
		);

		// Bake version into embedded deno.js so VERSION constant works without env var.
		// The npm package reads version from this embedded config, and without this fix
		// it would use the stale version from the original deno.json at build time.
		patchFile(
			"./npm/esm/deno.js",
			/"version":\s*"[^"]*"/,
			`"version": "${version}"`,
			"embedded deno.js version",
		);

		// Copy postinstall script
		await Deno.mkdir("./npm/scripts", { recursive: true });
		await Deno.copyFile("./scripts/postinstall.js", "./npm/scripts/postinstall.js");

		// Note: Templates are now embedded in manifest.json which is bundled by dnt
		// No need to copy template files separately

		// Copy bin wrapper
		await Deno.mkdir("./npm/bin", { recursive: true });
		await Deno.copyFile("./scripts/build/bin-wrapper.js", "./npm/bin/veryfront.js");
		await Deno.chmod("./npm/bin/veryfront.js", 0o755);

		// Copy LICENSE and README (must exist at repo root)
		await Deno.copyFile("./LICENSE", "./npm/LICENSE");
		await Deno.copyFile("./README.md", "./npm/README.md");

		// Copy base tsconfig for user projects to extend
		await Deno.writeTextFile("./npm/tsconfig.json", JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "Bundler",
				jsx: "react-jsx",
				strict: true,
				skipLibCheck: true,
				esModuleInterop: true,
				noEmit: true,
			},
		}, null, 2));

		// Update package.json with bin entry, postinstall, and type
		const pkgPath = "./npm/package.json";
		const pkg = JSON.parse(await Deno.readTextFile(pkgPath));
		pkg.type = "module"; // Required for ESM imports without warnings
		pkg.bin = { veryfront: "bin/veryfront.js" };
		pkg.files = ["esm", "script", "src", "bin", "scripts", "tsconfig.json", "LICENSE", "README.md"];
		pkg.scripts = { postinstall: "node scripts/postinstall.js" };
		pkg.exports["./tsconfig.json"] = "./tsconfig.json";
		await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2));
	},
});

/** Patch a generated file with string or regex replacement. Throws if pattern not found. */
function patchFile(
	path: string,
	search: string | RegExp,
	replacement: string,
	description: string,
): void {
	const content = Deno.readTextFileSync(path);
	const patched = typeof search === "string"
		? content.replace(search, replacement)
		: content.replace(search, replacement);
	if (patched === content) {
		throw new Error(
			`Patch failed: "${description}" did not match anything in ${path}. ` +
				`dnt output may have changed — update the patch or remove it if the bug is fixed.`,
		);
	}
	Deno.writeTextFileSync(path, patched);
	console.log(`📝 Patched ${description} in ${path}`);
}

/** Parse esm.sh URLs from deno.json imports into dnt mappings. */
function buildEsmShMappings(
	imports: Record<string, string>,
): Record<string, { name: string; version: string; subPath?: string }> {
	const mappings: Record<string, { name: string; version: string; subPath?: string }> = {};

	for (const url of Object.values(imports)) {
		if (!url.startsWith("https://esm.sh/")) continue;

		// Strip prefix and query params: "react@19.1.1/jsx-runtime"
		const pathPart = url.replace("https://esm.sh/", "").split("?")[0]!;

		// Match scoped (@scope/name@version/subPath) or regular (name@version/subPath)
		const match = pathPart.match(/^(@[^/]+\/[^@]+|[^@]+)@([^/]+)(?:\/(.+))?$/);
		if (!match) continue;

		const [, name, ver, subPath] = match;
		const entry: { name: string; version: string; subPath?: string } = { name: name!, version: ver! };
		if (subPath) entry.subPath = subPath;
		mappings[url] = entry;
	}

	return mappings;
}

console.log(`
✅ Build complete!

📦 Output: ./npm/

📋 Test locally:
   cd npm && npm link

   # In a test project:
   npm link veryfront

📋 Publish:
   cd npm && npm publish
`);
