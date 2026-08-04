# Issue #240 Phase 0: Studio bare specifiers (W2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Studio writing unversioned `https://esm.sh/...` URLs into user source files, so newly installed components arrive as bare specifiers with their exact versions recorded in `package.json`.

**Architecture:** Component install already makes one authenticated server round-trip (`POST /api/install-component` → `installComponentHandler`). That handler holds the registry schema, including the `dependencies: string[]` field currently dropped on the floor. Dependency resolution rides that existing request rather than adding a client round-trip, and the client-side transform simply stops rewriting specifiers. Resolution fails open: a resolver outage degrades to today's behavior, never to a failed install.

**Tech Stack:** TypeScript, React, Hono on Express (Studio backend), Vitest, Zod.

**Repository:** `veryfront-studio` for every task.

**Source spec:** `docs/superpowers/specs/2026-08-04-issue-240-phase-0-close-design.md` (W2). Sibling plan for W0/W1: `2026-08-04-issue-240-phase-0-cohort-and-url-pinning.md`.

## Context an implementer needs

- `convertPackageImportsToRemoteEsmUrlImports` (`studio/panels/code/subsystems/install/lib/convertImports.ts:3-38`) rewrites every non-ignored bare import to `https://esm.sh/${importPath}`, unversioned, with a hardcoded host. It is called from `processFileContent` (`prepareInstallFiles.ts:101`).
- `prepareInstallFiles` (`prepareInstallFiles.ts:257`) is **pure and synchronous**. Do not make it async: it is called from `useInstallForm.ts:94` and covered by three test files that call it directly.
- The renderer resolves bare specifiers through its own pin ladder, and as of veryfront-code#3368 also pins esm.sh URLs already in source. **Existing files therefore keep working unchanged either way**; this plan stops new debt rather than fixing old files. That is why no flag day is needed.
- `RegistrySchema.dependencies?: string[]` is at `shared/types/shadcn.ts:36`. Only `registryDependencies` is honored today.
- The platform endpoint already exists and has zero callers: `POST /projects/{project_reference}/dependencies/resolve` in `veryfront-api`, accepting bare names, inline exact versions, and semver ranges, with an optional `branch`.
- Studio's backend proxies to the platform API via `createProxyHandler({ forwardAuth: true })` (`server/app/createStudioApp.ts:201-208`). `installComponentHandler` is already behind `authMiddleware` (`:193`).

## Global Constraints

- **Resolution must fail open.** If the resolve call errors, times out, or returns partial results, the install still completes with bare specifiers. A resolver blip must never become an install outage. This is the single most important property in this plan.
- **Never reintroduce a host literal in client code.** After Task 1 no file under `studio/panels/` may contain `esm.sh`.
- **`prepareInstallFiles` stays pure and synchronous.**
- **React and the `@repo/shadcn-ui` alias keep their existing exclusions**: they are handled by alias transformation and the framework's own React ladder.
- Run `pnpm lint` and the relevant `pnpm test` lane before each commit.

---

### Task 1: Stop rewriting bare imports to esm.sh URLs

**Files:**
- Modify: `studio/panels/code/subsystems/install/lib/convertImports.ts:3-38`
- Modify: `studio/panels/code/subsystems/install/lib/convertImports.unit.test.ts`
- Modify: `studio/panels/code/subsystems/install/lib/prepareInstallFiles.unit.test.ts`
- Modify: `studio/panels/code/subsystems/install/lib/prepareInstallFiles.comprehensive.unit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: installed file content containing bare specifiers. Task 2 reads those specifiers.

- [ ] **Step 1: Rewrite the unit test to assert the new contract**

Replace the body of `convertImports.unit.test.ts`'s first two cases:

```ts
it('leaves bare package imports untouched', () => {
  const result = convertPackageImportsToRemoteEsmUrlImports("import _ from 'lodash'")
  expect(result).toContain("'lodash'")
  expect(result).not.toContain('esm.sh')
})

it('leaves scoped package imports untouched', () => {
  const result = convertPackageImportsToRemoteEsmUrlImports("import { DndContext } from '@dnd-kit/core'")
  expect(result).toContain("'@dnd-kit/core'")
  expect(result).not.toContain('esm.sh')
})

it('still leaves react imports untouched', () => {
  const result = convertPackageImportsToRemoteEsmUrlImports("import React from 'react'")
  expect(result).toContain("'react'")
  expect(result).not.toContain('esm.sh')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run studio/panels/code/subsystems/install/lib/convertImports.unit.test.ts`
Expected: FAIL: the first two cases receive `'https://esm.sh/lodash'` and `'https://esm.sh/@dnd-kit/core'`.

- [ ] **Step 3: Delete the rewrite**

The function's only remaining job would be identity. Delete `convertPackageImportsToRemoteEsmUrlImports` entirely, remove its import at `prepareInstallFiles.ts:7`, and delete the call at `prepareInstallFiles.ts:101`. Deleting beats keeping an identity function that still names esm.sh.

Delete `convertImports.unit.test.ts`'s cases for that function too: Step 1's tests exist to drive the change; once the function is gone, the surviving guarantee belongs in `prepareInstallFiles`'s tests, which already assert the import shape of installed files.

- [ ] **Step 4: Update the install-file expectation fixtures**

In `prepareInstallFiles.unit.test.ts` and `prepareInstallFiles.comprehensive.unit.test.ts`, drop the `https://esm.sh/` prefix from every expected import. For example `'https://esm.sh/motion/react'` becomes `'motion/react'`, `'https://esm.sh/@dnd-kit/core'` becomes `'@dnd-kit/core'`. There are roughly 15 such strings; change only the expectations, never the fixture inputs.

- [ ] **Step 5: Run the install lane and commit**

```bash
pnpm vitest run studio/panels/code/subsystems/install
pnpm lint
git add studio/panels/code/subsystems/install
git commit -m "fix(install): keep bare specifiers in installed component files

A URL in a source file never reaches the renderer's pin ladder, so every
dependency installed through component install floated regardless of the
pinning work already merged. Existing files keep working: the renderer now
pins unversioned esm.sh URLs too, so no migration is required."
```

---

### Task 2: Resolve and pin declared dependencies during install

Resolution runs server-side inside the handler that already makes the round-trip, so the install gains no new client request and no new proxy route.

**Files:**
- Modify: `server/install-component/handler.ts`
- Create: `server/install-component/resolveDependencies.ts`
- Create: `server/install-component/resolveDependencies.unit.test.ts`

**Interfaces:**
- Consumes: bare specifiers from Task 1; `RegistrySchema.dependencies` (`shared/types/shadcn.ts:36`).
- Produces: `resolveInstallDependencies(params: { projectReference: string; specifiers: string[]; branch?: string; authHeader?: string; fetchImpl?: typeof fetch }): Promise<{ resolved: Record<string, string>; failed: boolean }>`. Never rejects.

- [ ] **Step 1: Read the handler to find the seam**

Run: `sed -n '1,80p' server/install-component/handler.ts`

Identify where the registry schema is in hand and the response is assembled. The resolve call goes there, after the schema is fetched and before the response is returned. Record the exact variable names; the steps below use `schema` and `projectId` as placeholders and must be adapted to what the file actually calls them.

- [ ] **Step 2: Write the failing test**

Create `server/install-component/resolveDependencies.unit.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { collectInstallSpecifiers, resolveInstallDependencies } from './resolveDependencies'

describe('collectInstallSpecifiers', () => {
  it('collects declared dependencies and bare imports, ignoring react and aliases', () => {
    const specifiers = collectInstallSpecifiers({
      declared: ['zod@^3', 'recharts'],
      fileContents: [
        "import { DndContext } from '@dnd-kit/core'\nimport React from 'react'",
        "import { cn } from '@/lib/utils'\nimport _ from 'lodash'",
      ],
    })
    expect(specifiers.sort()).toEqual(['@dnd-kit/core', 'lodash', 'recharts', 'zod@^3'])
  })

  it('de-duplicates across declarations and imports', () => {
    const specifiers = collectInstallSpecifiers({
      declared: ['lodash'],
      fileContents: ["import _ from 'lodash'"],
    })
    expect(specifiers).toEqual(['lodash'])
  })
})

describe('resolveInstallDependencies', () => {
  it('returns the resolved pin map on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ resolved: { lodash: '4.17.21' } }),
    })
    const result = await resolveInstallDependencies({
      projectReference: 'proj-1',
      specifiers: ['lodash'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ resolved: { lodash: '4.17.21' }, failed: false })
  })

  it('fails open when the resolver errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('upstream down'))
    const result = await resolveInstallDependencies({
      projectReference: 'proj-1',
      specifiers: ['lodash'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ resolved: {}, failed: true })
  })

  it('fails open on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    const result = await resolveInstallDependencies({
      projectReference: 'proj-1',
      specifiers: ['lodash'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.failed).toBe(true)
    expect(result.resolved).toEqual({})
  })

  it('skips the request entirely when there is nothing to resolve', async () => {
    const fetchImpl = vi.fn()
    const result = await resolveInstallDependencies({
      projectReference: 'proj-1',
      specifiers: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toEqual({ resolved: {}, failed: false })
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run server/install-component/resolveDependencies.unit.test.ts`
Expected: FAIL: module not found.

- [ ] **Step 4: Implement**

Create `server/install-component/resolveDependencies.ts`. Reuse the project's existing import-manifest helper for extracting specifiers rather than writing a new regex: check whether `getImportManifestFromContent` is importable from the server side, and if it is not, extract the shared piece rather than duplicating it.

```ts
/** Specifiers that never resolve through the platform resolver. */
function isExcludedSpecifier(specifier: string): boolean {
  return (
    specifier === 'react' ||
    specifier === 'react-dom' ||
    specifier.startsWith('react/') ||
    specifier.startsWith('react-dom/') ||
    specifier.startsWith('@/') ||
    specifier.startsWith('.') ||
    specifier.startsWith('@repo/shadcn-ui') ||
    specifier.startsWith('http://') ||
    specifier.startsWith('https://')
  )
}

export function collectInstallSpecifiers(params: {
  declared?: string[]
  fileContents: string[]
}): string[] {
  const specifiers = new Set<string>()
  for (const declared of params.declared ?? []) {
    if (declared && !isExcludedSpecifier(declared)) specifiers.add(declared)
  }
  for (const content of params.fileContents) {
    for (const importPath of extractBareImportPaths(content)) {
      if (!isExcludedSpecifier(importPath)) specifiers.add(importPath)
    }
  }
  return [...specifiers]
}

export async function resolveInstallDependencies(params: {
  projectReference: string
  specifiers: string[]
  branch?: string
  authHeader?: string
  fetchImpl?: typeof fetch
}): Promise<{ resolved: Record<string, string>; failed: boolean }> {
  if (params.specifiers.length === 0) return { resolved: {}, failed: false }

  const doFetch = params.fetchImpl ?? fetch
  try {
    const response = await doFetch(
      `${apiBaseUrl()}/projects/${encodeURIComponent(params.projectReference)}/dependencies/resolve`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(params.authHeader ? { Authorization: params.authHeader } : {}),
        },
        body: JSON.stringify({
          specifiers: params.specifiers,
          ...(params.branch ? { branch: params.branch } : {}),
        }),
      }
    )
    if (!response.ok) return { resolved: {}, failed: true }
    const body = await response.json()
    return { resolved: body?.resolved ?? {}, failed: false }
  } catch {
    // Fail open: a resolver outage degrades to unpinned imports, which the
    // renderer still resolves at render time. It must never fail the install.
    return { resolved: {}, failed: true }
  }
}
```

Match `apiBaseUrl()` and the auth-forwarding convention to whatever `installComponentHandler` and `createProxyHandler` already use; do not invent a new configuration source.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run server/install-component/resolveDependencies.unit.test.ts`
Expected: PASS.

- [ ] **Step 6: Call it from the handler**

In `server/install-component/handler.ts`, after the registry schema is available, collect specifiers from the schema's `dependencies` **and** the file contents, then call the resolver. Await it, since it cannot reject and it rides a round-trip the install already makes, but do not let its result gate the response body's files.

Log a warning when `failed` is true so a silent resolver outage is visible, and include a `dependenciesResolved` boolean on the response so Task 3 can surface it.

- [ ] **Step 7: Run the server lane, lint, and commit**

```bash
pnpm vitest run server/install-component
pnpm lint
git add server/install-component
git commit -m "feat(install): resolve and pin declared dependencies during install

Honors the registry schema's dependencies field, which was previously dropped
on the floor, alongside the bare specifiers in installed files. Rides the
round-trip the install already makes.

Fails open by construction: a resolver outage degrades to unpinned imports
that the renderer still resolves at render time, never to a failed install."
```

---

### Task 3: Repoint Monaco import click-through

Behavioral, not cosmetic. `openLink` (`studio/panels/code/hooks/useMonacoOpenLink.ts:57-65`) branches on `isRemotePackageImport` and calls `window.open(importPath)`, which only works because the specifier is currently a URL. After Task 1 that branch stops matching and clicking a package import **silently does nothing**.

**Files:**
- Modify: `studio/panels/code/hooks/useMonacoOpenLink.ts:57-65`
- Create or modify: the hook's unit test

**Interfaces:**
- Consumes: bare specifiers from Task 1.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Assert that a bare package specifier opens its npmjs.com page and that a URL specifier still opens directly:

```ts
it('opens npmjs.com for a bare package specifier', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  await openLink('lodash')
  expect(open).toHaveBeenCalledWith('https://www.npmjs.com/package/lodash', '_blank', 'noopener,noreferrer')
})

it('opens npmjs.com for a scoped package with a subpath', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  await openLink('@dnd-kit/core/dist')
  expect(open).toHaveBeenCalledWith('https://www.npmjs.com/package/@dnd-kit/core', '_blank', 'noopener,noreferrer')
})

it('still opens a URL specifier directly', async () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  await openLink('https://esm.sh/lodash@4.17.21')
  expect(open).toHaveBeenCalledWith('https://esm.sh/lodash@4.17.21', '_blank', 'noopener,noreferrer')
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL: the bare cases call `window.open` zero times, because neither `isRemotePackageImport` nor the local-file lookup matches.

- [ ] **Step 3: Implement**

Add a bare-package branch that strips any subpath and inline version to build the npm package URL, keeping the existing URL branch first. Strip a trailing `@version` only when it is not the leading character of a scope.

- [ ] **Step 4: Run, lint, commit**

```bash
pnpm vitest run studio/panels/code/hooks
pnpm lint
git add studio/panels/code/hooks
git commit -m "fix(code): open npmjs.com for bare package specifiers

Import click-through matched only URL specifiers, so once installs write bare
specifiers a click would have silently done nothing."
```

---

### Task 4: Boilerplate template cleanup and a repo-wide guard

**Files:**
- Modify: `studio/panels/code/subsystems/files/hooks/useCreateFileMutation.tsx:25`
- Create: `studio/panels/code/subsystems/install/lib/no-esm-sh-literals.unit.test.ts`

- [ ] **Step 1: Write the guard test**

```ts
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Acceptance criterion 2 of issue #240: Studio never writes a dependency URL
 * into user source. The host literal is the thing to guard: a future edit
 * that reintroduces it would silently restore the floating-dependency class.
 */
describe('studio never emits esm.sh literals into user source', () => {
  it('has no esm.sh host literal under studio/panels', () => {
    const offenders = globSync('studio/panels/**/*.{ts,tsx}')
      .filter((file) => !file.includes('.test.'))
      .filter((file) => readFileSync(file, 'utf8').includes('esm.sh'))
    expect(offenders).toEqual([])
  })
})
```

Adapt the glob helper to whatever the repo already uses for filesystem-walking tests; do not add a dependency for this.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, listing `useCreateFileMutation.tsx` (the baked `https://esm.sh/got@12.6.1?target=node` boilerplate).

- [ ] **Step 3: Fix the boilerplate**

Change the serverless template's import to the bare specifier `got`. The template is scaffolded into user projects, so it must follow the same rule as installed components.

- [ ] **Step 4: Run, lint, commit**

```bash
pnpm vitest run studio/panels/code/subsystems/install
pnpm lint
git add studio/panels/code
git commit -m "test(install): guard against esm.sh literals in studio panels

Also fixes the serverless boilerplate, which baked an esm.sh URL into every
scaffolded project."
```

---

### Task 5: Full verification

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test:all
```
Expected: PASS. Any failure mentioning `esm.sh` is a missed expectation fixture from Task 1.

- [ ] **Step 2: Lint and typecheck**

```bash
pnpm lint
pnpm build-check
```

- [ ] **Step 3: Manual staging check against the acceptance criteria**

Install a registry component that pulls at least one third-party dependency, then confirm:

1. No installed file contains `esm.sh`.
2. `package.json` gained an exact version for each dependency, including any declared only in the registry schema's `dependencies` array.
3. The preview renders.
4. Clicking a package import in Monaco opens its npmjs.com page.
5. With the resolver made to fail (point it at an unreachable base URL), the install still succeeds and the preview still renders.

Item 5 is the one most likely to be skipped and the most important: it is the fail-open guarantee.

---

## Out of scope

- **W3, the lazy codemod** for esm.sh URLs already in existing user files. veryfront-code#3368 pins those at render time, so migrating them is source hygiene rather than a safety fix, and it gets its own plan.
- **`veryfront-code`** changes of any kind. W0 and W1 are in the sibling plan and already merged or in review.
