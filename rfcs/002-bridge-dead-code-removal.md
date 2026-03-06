# RFC: Bridge Dead Code Removal

## Problem

The bridge inspector contains code that is no longer consumed. It runs on every page load and every DOM mutation, posting messages that Studio ignores.

## Dead Code

### `data-vf-id` attribute

**Defined in:** `bridge-constants.ts`, `types.ts`
**Read in:** `bridge-inspector.ts` (11 references across `getNodeName`, `findElementById`, `getNodeType`, `buildNavigatorTree`, `scrollToElement`, `setupInspectMode`)
**Written by:** Nothing. No compiler, transform, or runtime code ever sets `data-vf-id` on a DOM element.

The Babel transform (`babel-node-positions.ts`) has a guard that skips elements with `data-vf-id`, but since nothing writes it, this guard never triggers.

### `buildNavigatorTree` and mutation observer

**Functions:** `buildNavigatorTree`, `sendTreeUpdate`, `debouncedTreeUpdate`, `createTreeSignature`, `setupMutationObserver`
**Called from:** `bridge-init.ts` — runs `setupMutationObserver()` on every page load
**Sends:** `treeUpdated` message to Studio on every relevant DOM mutation (debounced 150ms)
**Consumed by:** Nothing. Studio's `useIFrameMessageEvents.ts` has no `case 'treeUpdated'` handler. The message is defined in the schema and types but ignored.

This means on every page load, a `MutationObserver` is set up that walks the entire DOM, builds a tree structure, and posts it to Studio — which throws it away. This runs again on every DOM change (child additions, text changes).

### `data-vf-text` attribute

**Defined in:** `bridge-constants.ts`, `types.ts`
**Used in:** `buildNavigatorTree` only — to detect text nodes and read `textContent`
**Dies with:** `buildNavigatorTree` removal

### `data-node-id` (meaningless counter)

**Injected by:** `babel-node-positions.ts` — assigns `node-1`, `node-2`, etc.
**Read by:** Bridge inspector uses it as an element identifier, but it carries no semantic meaning. RFC 001 replaces it with `data-node-file` + `data-node-name` + `data-node-line` + `data-node-column`.

### `data-node-end-line` / `data-node-end-column`

**Injected by:** `babel-node-positions.ts`
**Read by:** Nothing in the bridge. Only `data-node-line` and `data-node-column` are used.

### `data-node-start` / `data-node-end` (byte offsets)

**Injected by:** `remark-node-id.ts` (properties `data-node-start`, `data-node-end`)
**Read by:** Nothing in the bridge. Only `data-node-line` and `data-node-column` are read.

### `lastTreeSignature` state

**Defined in:** `bridge-state.ts`
**Used by:** `sendTreeUpdate` only — signature comparison to skip duplicate tree posts
**Dies with:** `buildNavigatorTree` removal

## Proposed Removal

| Item | Location | Notes |
|------|----------|-------|
| `DATA_VF_ID` constant | `bridge-constants.ts`, `types.ts` | Nothing writes this attribute |
| `DATA_VF_TEXT` constant | `bridge-constants.ts`, `types.ts` | Only used by tree builder |
| `data-vf-id` references | `bridge-inspector.ts` (11 refs) | Replace with `DATA_NODE_ID` / `DATA_VF_SELECTOR` where used as fallback |
| `buildNavigatorTree` | `bridge-inspector.ts` | Dead — Studio ignores `treeUpdated` |
| `sendTreeUpdate` | `bridge-inspector.ts` | Dead |
| `debouncedTreeUpdate` | `bridge-inspector.ts` | Dead |
| `createTreeSignature` | `bridge-inspector.ts` | Dead |
| `setupMutationObserver` | `bridge-inspector.ts` | Dead — remove call from `bridge-init.ts` too |
| `treeUpdateTimer` | `bridge-inspector.ts` | Dead |
| `mutationObserver` | `bridge-inspector.ts` | Dead |
| `lastTreeSignature` | `bridge-state.ts` | Dead |
| `treeUpdated` schema | `studio.schema.ts` | No consumer (confirm with Studio team — confirmed) |
| `DATA_NODE_ID` constant | `bridge-constants.ts` | Meaningless counter, replaced by file/name/line/column (RFC 001) |
| `DATA_NODE_END_LINE/COLUMN` constants | `bridge-constants.ts` | Never read by bridge |
| `data-node-id` injection | `babel-node-positions.ts` | Remove `node-N` counter and attribute injection |
| `data-node-end-line/column` injection | `babel-node-positions.ts` | End positions never read by bridge |
| `data-node-start/end` | `remark-node-id.ts` | Byte offsets, never read by bridge |
| `hasPositionAttribute` guard | `babel-node-positions.ts` | Checks for `data-vf-id` which is never set |

## Keep

| Item | Reason |
|------|--------|
| `DATA_VF_IGNORE` | Actively used — marks overlays, carets, selection highlights |
| `DATA_VF_SELECTOR` | Runtime fallback ID for untransformed elements |
| `DATA_NODE_LINE/COLUMN` | Used by inspect mode + transforms |

## Impact

- **Performance**: Removes a `MutationObserver` that walks the DOM on every change
- **Payload**: Eliminates `treeUpdated` postMessages that Studio ignores
- **Code size**: ~100 lines removed from `bridge-inspector.ts`
- **Risk**: Low — Studio confirmed no `treeUpdated` consumer exists
