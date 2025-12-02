# npm Package Compatibility

This document tracks the compatibility status of the veryfront npm package for Node.js and Bun runtimes.

## Status: Partial Compatibility

The npm package can be installed and the CLI can run basic commands (`--help`, `init`). However, there are remaining issues with some commands.

## Working Commands

- `npx veryfront --help` - Shows help output
- `npx veryfront init` - Initializes a new project

## Known Issues

### 1. Build Command - ES Module Config Loading

**Error:**
```
Warning: Failed to load the ES module: veryfront.config.js
Make sure to set "type": "module" in the nearest package.json or use .mjs extension
```

**Cause:** The generated `veryfront.config.js` uses ES module syntax (`export default`) but the test project doesn't have `"type": "module"` in package.json.

**Fix needed:** Either:
- Generate config with `.mjs` extension
- Add `"type": "module"` to generated package.json
- Support CommonJS config syntax as fallback

### 2. Build Command - JSX File Import

**Error:**
```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".jsx" for Button.jsx
```

**Cause:** Node.js cannot natively import `.jsx` files without a loader or transpilation step.

**Fix needed:** The component loader needs to transpile JSX files before dynamic import, or use esbuild to bundle them first.

### 3. Missing Templates Directory

**Error:**
```
ENOENT: no such file or directory 'templates/client-styles.css'
```

**Cause:** Template files are not being included in the npm bundle.

**Fix needed:** Add templates directory to the build script output or embed templates as strings.

## Fixed Issues (Completed)

The following Deno-specific API usages have been fixed with cross-platform alternatives:

| File | Original API | Fixed With |
|------|-------------|------------|
| `build-orchestrator.ts` | `Deno.stat` | `createFileSystem().exists()` |
| `environment.ts` | `Deno.env.get` | `getEnv()` from platform compat |
| `temp-directory.ts` | `Deno.makeTempDir` | `os.tmpdir()` + `fs.mkdir()` |
| `build-context.ts` | `Deno.writeTextFile` | `createFileSystem().writeTextFile()` |
| `component-loader.ts` | `Deno.mkdir`, `Deno.writeTextFile` | `createFileSystem()` methods |
| `manifest-builder.ts` | `createFileSystem().readFile`, `writeTextFile` | Local helper functions |
| `client-runtime.ts` | `createFileSystem().stat`, `readTextFile` | Local helper functions |

## Platform Compatibility Layer

The project uses a platform compatibility layer in `src/platform/compat/` for cross-runtime support:

- **`fs.ts`** - File system operations (`createFileSystem()`)
- **`process.ts`** - Environment and process info (`getEnv()`, `getCwd()`, etc.)
- **`console/`** - Cross-platform logging

## Testing npm Package

```bash
# Build the npm package
deno task build:npm

# Install dependencies
cd npm && npm install && cd ..

# Link globally
cd npm && npm link && cd ..

# Test in a new directory
mkdir /tmp/test-veryfront && cd /tmp/test-veryfront
npm link veryfront
npx veryfront init
npx veryfront build  # May have issues listed above
```
