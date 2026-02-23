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
const license = denoJson.license ?? "Apache-2.0";

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
		// esm.sh URLs - map to npm packages (only include URLs actually imported)
		"https://esm.sh/react@19.1.1?target=es2022&deps=csstype@3.2.3": {
			name: "react",
			version: "19.1.1",
		},
		"https://esm.sh/react-dom@19.1.1/server?external=react&target=es2022&deps=csstype@3.2.3": {
			name: "react-dom",
			version: "19.1.1",
			subPath: "server",
		},
		"https://esm.sh/react@19.1.1/jsx-runtime?external=react&target=es2022&deps=csstype@3.2.3": {
			name: "react",
			version: "19.1.1",
			subPath: "jsx-runtime",
		},
		"https://esm.sh/tailwindcss@4.1.8": {
			name: "tailwindcss",
			version: "4.1.8",
		},
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
			try {
				await Deno.copyFile(`${rscSrc}/${file}`, `${rscDest}/${file}`);
			} catch {
				console.warn(`⚠️ Could not copy ${file}`);
			}
		}
		console.log(`📝 Copied ${rscClientFiles.length} RSC client files`);

		// Fix dnt polyfill bug: process.argv[1] can be undefined in dynamic imports
		const polyfillPath = "./npm/esm/_dnt.polyfills.js";
		let polyfillContent = await Deno.readTextFile(polyfillPath);
		polyfillContent = polyfillContent.replace(
			'process.argv[1].replace',
			'(process.argv[1] ?? "").replace',
		);
		await Deno.writeTextFile(polyfillPath, polyfillContent);

		// Bake version into embedded deno.js so VERSION constant works without env var.
		// The npm package reads version from this embedded config, and without this fix
		// it would use the stale version from the original deno.json at build time.
		const denoJsPath = "./npm/esm/deno.js";
		try {
			let denoJsContent = await Deno.readTextFile(denoJsPath);
			denoJsContent = denoJsContent.replace(
				/"version":\s*"[^"]*"/,
				`"version": "${version}"`,
			);
			await Deno.writeTextFile(denoJsPath, denoJsContent);
			console.log(`📝 Updated embedded deno.js version to ${version}`);
		} catch (error) {
			console.warn(`⚠️ Could not update embedded deno.js version: ${error}`);
		}

		// Copy postinstall script
		await Deno.mkdir("./npm/scripts", { recursive: true });
		await Deno.copyFile("./scripts/postinstall.js", "./npm/scripts/postinstall.js");

		// Note: Templates are now embedded in manifest.json which is bundled by dnt
		// No need to copy template files separately

		// Create bin wrapper
		await Deno.mkdir("./npm/bin", { recursive: true });
		await Deno.writeTextFile("./npm/bin/veryfront.js", `#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

await import('../esm/_dnt.polyfills.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const nativeBinary = join(__dirname, process.platform === 'win32' ? 'veryfront.exe' : 'veryfront');

async function runJsFallback() {
  await import('../esm/cli/main.js');
}

if (existsSync(nativeBinary)) {
  const child = spawn(nativeBinary, process.argv.slice(2), { stdio: 'inherit' });
  child.on('close', (code) => process.exit(code ?? 0));
  child.on('error', () => runJsFallback().catch(err => { console.error(err); process.exit(1); }));
} else {
  runJsFallback().catch(err => { console.error(err); process.exit(1); });
}
`);
		await Deno.chmod("./npm/bin/veryfront.js", 0o755);

		// Copy LICENSE (generate default if missing)
		await copyFileOrGenerate("./LICENSE", "./npm/LICENSE", generateApacheLicense);

		// Copy README (optional)
		await copyFileIfExists("./README.md", "./npm/README.md");

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

async function copyFileIfExists(src: string, dest: string): Promise<void> {
	try {
		await Deno.copyFile(src, dest);
	} catch {
		// Ignore if file doesn't exist
	}
}

async function copyFileOrGenerate(
	src: string,
	dest: string,
	generate: () => string,
): Promise<void> {
	try {
		await Deno.copyFile(src, dest);
	} catch {
		await Deno.writeTextFile(dest, generate());
	}
}

function generateApacheLicense(): string {
	const year = new Date().getFullYear();
	return `Copyright ${year} Veryfront GmbH

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`;
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
