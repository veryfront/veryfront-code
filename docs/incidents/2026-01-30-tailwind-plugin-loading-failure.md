# Incident: Tailwind CSS Plugin Loading Failure in Compiled Binary

**Date**: 2026-01-30
**Severity**: High (P1)
**Duration**: ~2 hours
**Affected Projects**: codersociety.com and any project using Tailwind CSS v4 plugins

## Summary

Veryfront renderer pods crashed with "Failed to load plugin 'tailwindcss-animate': Module not found" error after deploying v0.1.0-rc.62. The root cause was that Deno compiled binaries cannot dynamically import URLs that weren't bundled at compile time.

## Timeline

- **01:26 UTC** - v0.1.0-rc.62 deployed to production (with HTTP cache fixes from previous incident)
- **01:52 UTC** - codersociety.com returning 500 Internal Server Error
- **01:52 UTC** - Logs show: `Failed to load plugin "tailwindcss-animate": Module not found: https://esm.sh/tailwindcss-animate`
- **01:55 UTC** - Root cause identified: Deno compile restrictions on dynamic imports
- **01:57 UTC** - First fix attempted with `--include` flags for common plugins
- **01:58 UTC** - Build failed: `tailwind-scrollbar-hide` returns 500 from esm.sh
- **01:59 UTC** - Second fix: pinned problematic packages to working versions
- **02:00 UTC** - Build failed: Windows PowerShell parsing error with multiline command
- **02:03 UTC** - Third fix: Use `shell: bash` for cross-platform compatibility
- **02:05 UTC** - Build failed: esm.sh returning 500 for unpinned `tailwindcss-animate`
- **02:08 UTC** - Fourth fix: Pin ALL packages to specific versions
- **02:14 UTC** - Build succeeded, v0.1.0-rc.66 released
- **02:14 UTC** - Cloud-renderer deployment triggered

## Root Cause Analysis

### The Problem

Tailwind CSS v4 uses a plugin system where stylesheets can declare plugins via `@plugin` directive:

```css
@import "tailwindcss";
@plugin "tailwindcss-animate";
@plugin "@tailwindcss/typography";
@plugin "tailwind-scrollbar-hide";
```

The veryfront renderer loads these plugins dynamically at runtime using:

```typescript
// src/html/styles-builder/tailwind-compiler.ts
const url = `https://esm.sh/${id}`;
mod = await import(url);
```

### Why It Worked Before

- In development mode, Deno runs directly and can perform HTTP imports dynamically
- This worked fine in `deno run` mode

### Why It Broke

1. The production renderer uses a compiled Deno binary (`deno compile`)
2. Deno compiled binaries **cannot dynamically import URLs that weren't known at compile time**
3. The error `Module not found: https://esm.sh/tailwindcss-animate` is Deno's way of saying "this URL wasn't bundled into the binary"

### Reproduction

```bash
# Create test file
cat > test.ts << 'EOF'
const mod = await import("https://esm.sh/tailwindcss-animate");
console.log("Success:", typeof mod.default);
EOF

# Works with deno run
deno run -A test.ts  # Success: object

# Fails with compiled binary
deno compile -A -o test test.ts
./test  # Error: Module not found: https://esm.sh/tailwindcss-animate
```

## Fix

### Solution: Bundle Common Plugins at Compile Time

Updated `.github/workflows/cicd.yml` to include commonly used Tailwind plugins with pinned versions:

```yaml
- name: Compile binary with version
  shell: bash  # Required for Windows compatibility
  run: |
    deno compile --allow-all --unstable-net \
      --include "https://esm.sh/tailwindcss-animate@1.0.7" \
      --include "https://esm.sh/@tailwindcss/typography@0.5.19" \
      --include "https://esm.sh/@tailwindcss/forms@0.5.11" \
      --include "https://esm.sh/tailwind-scrollbar-hide@2.0.0" \
      --include "https://esm.sh/daisyui@5.5.14" \
      --target ${{ matrix.target }} --output ${{ matrix.name }} src/cli/main.ts
```

### Additional Issues Encountered

1. **PowerShell parsing error on Windows**: The `--` prefix was interpreted as a unary operator by PowerShell. Fix: explicitly set `shell: bash`.

2. **esm.sh intermittent 500 errors**: Unpinned package versions occasionally return 500 errors. Fix: pin ALL packages to specific versions.

## Learnings

### 1. Compiled Deno Binaries Have Different Behavior

**Learning**: Dynamic HTTP imports that work in `deno run` do not work in `deno compile` unless explicitly bundled with `--include`.

**Action**: Document this limitation in developer docs and test critical paths with compiled binaries.

### 2. Test Production Build Artifacts

**Learning**: The local development experience can differ significantly from the production compiled binary.

**Action**: Add CI step to test the compiled binary with representative project configurations.

### 3. esm.sh Reliability

**Learning**: esm.sh can return 500 errors for certain package versions, especially latest/unpinned versions.

**Action**:
- Use pinned versions for critical dependencies in compile `--include` flags
- Consider caching or mirroring commonly used plugins

### 4. Plugin Discovery Pattern

**Learning**: We need a way to know which plugins to bundle without knowing all possible plugins ahead of time.

**Future Options**:
1. Bundle a curated list of common plugins (current approach)
2. Implement fetch-and-eval fallback for non-bundled plugins
3. Pre-analyze project stylesheets and bundle required plugins per-project
4. Use a proxy service that can serve plugins with proper caching

## Prevention Measures

### Short Term (Implemented)

1. Bundle common Tailwind plugins in compiled binary
2. Pin esm.sh package versions to avoid 500 errors
3. Added this incident documentation

### Medium Term (Recommended)

1. Add integration test that runs compiled binary with sample projects
2. Implement fallback loading mechanism for non-bundled plugins
3. Add health check that validates plugin loading capability

### Long Term (Future)

1. Consider server-side plugin registry with caching
2. Evaluate alternatives to dynamic imports for plugin loading
3. Pre-build plugin bundles per-project during deployment

## Related Commits

- `1f93ed67` - fix(build): include Tailwind CSS plugins in compiled binary
- `1ca075be` - fix(build): use pinned version for tailwind-scrollbar-hide
- `e189c511` - fix(build): use bash shell for compile step on all platforms
- `4a150800` - fix(build): pin all esm.sh packages to avoid intermittent 500 errors

## References

- [Deno Compile Documentation](https://docs.deno.com/runtime/reference/cli/compile/)
- [esm.sh](https://esm.sh/)
- Tailwind CSS v4 Plugin API
