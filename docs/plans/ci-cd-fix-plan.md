# CI/CD Fix Plan for Veryfront CLI and Package

## Executive Summary

This plan addresses issues with the build and publish process for the Veryfront CLI and npm package. The current system has two separate distribution mechanisms that need to be aligned:

1. **npm package (`npm/`)** - Built via `deno task build:npm`, published to npm registry
2. **Binary distribution (`scripts/postinstall.js`)** - Downloads pre-compiled binaries from GitHub Releases

## Recent CI/CD Failures Analysis

### Failed Run: 20127414059 (2025-12-11T08:55:51Z)

**Root Cause**: npm provenance only works with public repositories

```
npm error 422 Unprocessable Entity - PUT https://registry.npmjs.org/veryfront
npm error Error verifying sigstore provenance bundle: Unsupported GitHub Actions
source repository visibility: "private". Only public source repositories are
supported when publishing with provenance.
```

**Fix**: The `--provenance` flag was removed from the workflow. The current `publish.yml` uses `npm publish --access public` without `--provenance`.

**Status**: Fixed - v0.0.70 published successfully in run 20129380458

### Successful Run: 20129380458 (2025-12-11T10:07:12Z)

- Published v0.0.70 successfully
- Used `npm publish --access public` (without `--provenance`)
- GitHub Release created with auto-generated notes

## Current Architecture Analysis

### Two Package.json Files (Confusion Point)

| File | Purpose | Publishes To |
|------|---------|--------------|
| `/package.json` (root) | Binary-only distribution with postinstall | npm (expects GitHub binaries) |
| `/npm/package.json` | Full npm package with bundled JS | npm (self-contained) |

**Problem**: The root `package.json` expects binaries on GitHub Releases, but the `publish.yml` workflow publishes the `npm/` directory content instead.

### CI/CD Workflow Analysis

#### CI Workflow (`ci.yml`) - OK
- Runs on push to main/master and PRs
- Format check, lint, typecheck, unit tests, integration tests
- No critical issues identified

#### Publish Workflow (`publish.yml`) - ISSUES FOUND

**Current Flow:**
1. Triggered on version tags (v*)
2. Validates tag matches `deno.json` version
3. Builds npm package via `deno task build:npm`
4. Publishes `npm/` directory to npm
5. Creates GitHub Release (without binaries!)

**Issues:**
1. **No binary compilation** - Binaries are not built during publish
2. **Missing binary upload** - GitHub Release has no binaries attached
3. **Broken postinstall** - Users with root package.json expect binaries that don't exist

---

## Issues Identified

### Issue 1: Conflicting Distribution Models

The repository has TWO distribution models that conflict:

**Model A (Root package.json):**
- Small stub package (~50KB)
- postinstall downloads binary from GitHub Releases
- Requires binaries to be uploaded to GitHub Releases

**Model B (npm/package.json):**
- Full bundled package (~several MB)
- Contains all JS code, no binary download needed
- Published by current CI workflow

**Current CI publishes Model B, but root package.json expects Model A.**

### Issue 2: Missing Binary Build Step in CI

The `publish.yml` workflow does NOT:
- Build platform binaries using `deno compile`
- Upload binaries to GitHub Releases
- Generate checksums

### Issue 3: Version Synchronization

Three version sources that must match:
- `deno.json` - Source of truth
- `npm/package.json` - Generated during build
- Root `package.json` - Manual update needed

### Issue 4: Unclear Which Package Gets Published

The workflow `cd npm && npm publish` publishes the bundled package, but the root `package.json` defines a different package structure.

---

## Recommended Solution

### Option A: Full npm Package (Recommended)

Publish the bundled npm package without binary downloads.

**Pros:**
- Single, self-contained package
- No GitHub Release dependency
- Works everywhere npm works
- Simpler CI/CD

**Cons:**
- Larger package size
- Uses Node.js runtime, not native binary

**Changes Required:**
1. Remove root `package.json` or mark it as internal
2. Update `publish.yml` to only publish from `npm/`
3. Update documentation
4. Remove `scripts/postinstall.js` from npm package

### Option B: Binary-First Distribution

Keep binary download approach but fix CI/CD.

**Pros:**
- Smaller npm package
- Native binary performance
- Works without Node.js at runtime

**Cons:**
- Complex CI/CD (multi-platform builds)
- GitHub Releases dependency
- Potential download failures

**Changes Required:**
1. Add binary compilation job to `publish.yml`
2. Upload binaries to GitHub Releases
3. Update root `package.json` to be the published package
4. Remove or deprecate `npm/` distribution

### Option C: Hybrid Approach

Publish BOTH packages under different names.

- `veryfront` - Bundled npm package (current npm/ output)
- `veryfront-cli` - Binary wrapper with postinstall

---

## Detailed Implementation Plan (Option A - Recommended)

### Phase 1: Clarify Package Structure

#### Task 1.1: Update Root package.json
```json
{
  "name": "veryfront-internal",
  "private": true,
  "description": "Internal - not published to npm"
}
```

#### Task 1.2: Ensure npm/package.json is Complete
Verify all necessary fields for npm publishing:
- name, version, description
- main, module, types, exports
- bin (CLI entry point)
- files (what to include)
- engines, peerDependencies
- repository, homepage, bugs

#### Task 1.3: Remove Binary Download from npm Package
The current `npm/` build already contains a proper CLI (`npm/bin/veryfront.js`), no binary download needed.

### Phase 2: Fix Publish Workflow

#### Task 2.1: Update publish.yml

```yaml
name: Publish to npm

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Validate tag matches deno.json version
        run: |
          TAG_VERSION="${GITHUB_REF#refs/tags/v}"
          DENO_VERSION=$(jq -r '.version' deno.json)
          if [ "$TAG_VERSION" != "$DENO_VERSION" ]; then
            echo "Error: Tag ($TAG_VERSION) != deno.json ($DENO_VERSION)"
            exit 1
          fi

      - uses: denoland/setup-deno@v2
        with:
          deno-version: lts

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'

      - name: Build npm package
        run: deno task build:npm

      - name: Verify package version
        run: |
          PKG_VERSION=$(jq -r '.version' npm/package.json)
          TAG_VERSION="${GITHUB_REF#refs/tags/v}"
          if [ "$PKG_VERSION" != "$TAG_VERSION" ]; then
            echo "Error: Package version mismatch"
            exit 1
          fi

      - name: Publish to npm
        working-directory: npm
        run: npm publish --access public --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          generate_release_notes: true
```

### Phase 3: Fix Release Script

#### Task 3.1: Update scripts/release.ts

Ensure the release script:
1. Updates `deno.json` version
2. Runs `deno task build:npm`
3. Verifies `npm/package.json` version matches
4. Does NOT reference binary compilation

### Phase 4: Clean Up

#### Task 4.1: Remove or Archive Binary Distribution Files
- Move `scripts/postinstall.js` to `scripts/archive/`
- Move `scripts/build-all.js` to `scripts/archive/`
- Update DISTRIBUTION.md to reflect new approach

#### Task 4.2: Update Documentation
- Update README.md installation instructions
- Update DISTRIBUTION.md
- Remove references to binary downloads

---

## Alternative: Option B Implementation (Binary-First)

If binary distribution is required, here's the additional workflow:

### Binary Build Workflow

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-binaries:
    strategy:
      matrix:
        include:
          - os: macos-14
            target: aarch64-apple-darwin
            output: veryfront-macos-arm64
          - os: macos-13
            target: x86_64-apple-darwin
            output: veryfront-macos-x64
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            output: veryfront-linux-x64
          - os: ubuntu-latest
            target: aarch64-unknown-linux-gnu
            output: veryfront-linux-arm64
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            output: veryfront-windows-x64.exe

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - uses: denoland/setup-deno@v2
        with:
          deno-version: lts

      - name: Build binary
        run: |
          deno compile --allow-all \
            --target ${{ matrix.target }} \
            --output dist/${{ matrix.output }} \
            src/cli/main.ts

      - name: Generate checksum
        run: |
          cd dist
          if [ "${{ runner.os }}" = "Windows" ]; then
            certutil -hashfile ${{ matrix.output }} SHA256 > ${{ matrix.output }}.sha256
          else
            sha256sum ${{ matrix.output }} > ${{ matrix.output }}.sha256
          fi

      - uses: actions/upload-artifact@v4
        with:
          name: binary-${{ matrix.target }}
          path: dist/

  publish:
    needs: build-binaries
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/download-artifact@v4
        with:
          path: dist
          pattern: binary-*
          merge-multiple: true

      - name: Create GitHub Release with Binaries
        uses: softprops/action-gh-release@v1
        with:
          files: |
            dist/veryfront-*
          generate_release_notes: true

      # Then publish npm package that uses postinstall...
```

---

## Testing Plan

### Pre-Release Testing
1. Run `deno task build:npm` locally
2. Test `npm pack` in `npm/` directory
3. Verify package contents with `npm pack --dry-run`
4. Test local installation: `npm install ./npm/veryfront-0.0.71.tgz`
5. Test CLI: `npx veryfront --help`

### Post-Release Verification
1. `npm install veryfront@latest`
2. `npx veryfront --version`
3. `npx veryfront init test-app`
4. `cd test-app && npx veryfront dev`

---

## Migration Checklist

- [ ] Decide on distribution model (A, B, or C)
- [ ] Update root package.json
- [ ] Update publish.yml workflow
- [ ] Update release.ts script
- [ ] Update documentation
- [ ] Test build locally
- [ ] Create test release (pre-release tag)
- [ ] Verify npm installation
- [ ] Update CHANGELOG

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing installs | High | Publish as new minor version, document changes |
| CI/CD failure | Medium | Test workflow in fork first |
| npm publish failure | High | Ensure NPM_TOKEN is valid, test with --dry-run |
| Version mismatch | Medium | Automated validation in CI |

---

## Recommended Immediate Actions

1. **Quick Win**: Fix publish.yml to properly publish from npm/ directory
2. **Document**: Update README with correct installation instructions
3. **Deprecate**: Mark root package.json as private/internal
4. **Test**: Create a pre-release (v0.0.71-beta.1) to test the flow

---

## Questions to Resolve

1. **Which distribution model to use?** (Bundled npm vs Binary download)
2. **Should both packages be published?** (veryfront + veryfront-cli)
3. **Is binary performance critical?** (If yes, consider Option B)
4. **NPM_TOKEN status?** (Verify secret is configured in GitHub)
