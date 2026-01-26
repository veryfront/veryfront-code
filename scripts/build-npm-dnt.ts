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
const version = Deno.env.get("VERYFRONT_VERSION") || denoJson.version || "0.0.75";

console.log(`\n📦 Building Veryfront v${version} for npm using dnt...\n`);

await emptyDir("./npm");

// Convert deno.json exports to dnt entry points
const entryPoints: Array<{ name: string; path: string }> = [];
for (const [name, path] of Object.entries(denoJson.exports as Record<string, string>)) {
	entryPoints.push({ name, path });
}

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
		"https://deno.land/std@0.220.0/fmt/colors.ts": {
			name: "picocolors",
			version: "^1.1.0",
		},
		"https://deno.land/std@0.220.0/flags/mod.ts": {
			name: "mri",
			version: "^1.2.0",
		},
		// Type-only packages - map to @types versions
		"npm:@types/mdast@4.0.3": {
			name: "@types/mdast",
			version: "^4.0.3",
		},
		"npm:@types/hast@3.0.3": {
			name: "@types/hast",
			version: "^4.0.3",
		},
		"npm:@types/unist@3.0.2": {
			name: "@types/unist",
			version: "^3.0.2",
		},
	},

	package: {
		name: "veryfront",
		version,
		description: "Zero-config React meta-framework for building agentic AI applications",
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
			"ws": ">=8.0.0",
			"better-sqlite3": ">=9.0.0",
		},
		peerDependenciesMeta: {
			"ws": { optional: true },
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
		// Fix dnt polyfill bug: process.argv[1] can be undefined in dynamic imports
		const polyfillPath = "./npm/esm/_dnt.polyfills.js";
		let polyfillContent = await Deno.readTextFile(polyfillPath);
		polyfillContent = polyfillContent.replace(
			'process.argv[1].replace',
			'(process.argv[1] ?? "").replace',
		);
		await Deno.writeTextFile(polyfillPath, polyfillContent);

		// Copy postinstall script
		await Deno.mkdir("./npm/scripts", { recursive: true });
		await Deno.copyFile("./scripts/postinstall.js", "./npm/scripts/postinstall.js");

		// Copy templates
		await copyDir("./src/cli/templates/files", "./npm/esm/cli/templates/files");
		await copyDir("./src/cli/templates/integrations", "./npm/esm/cli/templates/integrations");

		// Create bin wrapper
		await Deno.mkdir("./npm/bin", { recursive: true });
		await Deno.writeTextFile("./npm/bin/veryfront.js", `#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load dnt polyfills (import.meta shims) before any other imports
await import('../esm/_dnt.polyfills.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const nativeBinary = join(__dirname, process.platform === 'win32' ? 'veryfront.exe' : 'veryfront');

if (existsSync(nativeBinary)) {
  const child = spawn(nativeBinary, process.argv.slice(2), { stdio: 'inherit' });
  child.on('close', (code) => process.exit(code ?? 0));
  child.on('error', async () => {
    const { main } = await import('../esm/src/cli/index.js');
    main().catch(err => { console.error(err); process.exit(1); });
  });
} else {
  const { main } = await import('../esm/src/cli/index.js');
  main().catch(err => { console.error(err); process.exit(1); });
}
`);

		// Copy LICENSE
		try {
			await Deno.copyFile("./LICENSE", "./npm/LICENSE");
		} catch {
			await Deno.writeTextFile("./npm/LICENSE", `MIT License

Copyright (c) ${new Date().getFullYear()} Veryfront

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`);
		}

		// Copy README
		try {
			await Deno.copyFile("./README.md", "./npm/README.md");
		} catch {
			// Ignore if no README
		}

		// Update package.json with bin entry and postinstall
		const pkgPath = "./npm/package.json";
		const pkg = JSON.parse(await Deno.readTextFile(pkgPath));
		pkg.bin = { veryfront: "./bin/veryfront.js" };
		pkg.files = ["esm", "script", "src", "bin", "scripts", "LICENSE", "README.md"];
		pkg.scripts = { postinstall: "node scripts/postinstall.js" };
		await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2));
	},
});

async function copyDir(src: string, dest: string): Promise<void> {
	await Deno.mkdir(dest, { recursive: true });
	for await (const entry of Deno.readDir(src)) {
		const srcPath = `${src}/${entry.name}`;
		const destPath = `${dest}/${entry.name}`;
		if (entry.isDirectory) {
			await copyDir(srcPath, destPath);
		} else if (entry.isFile) {
			await Deno.copyFile(srcPath, destPath);
		}
	}
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
