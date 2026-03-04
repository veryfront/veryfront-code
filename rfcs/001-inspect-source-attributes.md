# RFC: Per-Element Source Location Attributes for Studio Inspect

## Problem

When a user selects a DOM element in Studio's inspect mode, we cannot tell the chat agent **which file and line** the element comes from. The bridge sends only a string ID, and the tree uses `config.pagePath` for all nodes — which is the **page file**, not the component's source file.

Example: A `<h1>` rendered by `components/Welcome.tsx` (imported into `pages/index.tsx`) reports its path as `pages/index.tsx`. The chat agent looks in the wrong file.

### Prior art

Lovable injects per-element source attributes:

```html
<p data-lov-id="src/components/Hero.tsx:19:14"
   data-component-path="src/components/Hero.tsx"
   data-component-line="19"
   data-component-file="Hero.tsx"
   data-component-name="p"
   data-component-content="%7B%22text%22%3A...%7D">
```

We can achieve the same with two attributes instead of six.

## Current State

The Babel transform (`babel-node-positions.ts`) already injects line/column on every JSX element when `studio_embed=true`:

```html
<h1 data-node-id="node-3" data-node-line="5" data-node-column="4" data-node-end-line="7" data-node-end-column="10">
```

The file path is **passed to the function but never used**:

```typescript
export function injectNodePositions(source: string, _options: TransformOptions): string {
//                                                   ^ unused
```

Both call sites already provide it:

```typescript
// module-server.ts
injectNodePositions(source, { filePath: sourceFile })

// component-handling.ts
injectNodePositions(rawFileContent, { filePath: pageInfo.entity.path })
```

The browser loader already propagates `studio_embed=true` to all imported module requests, so `components/Welcome.tsx` already gets transformed — it just doesn't inject the file path.

## Proposal

### Target DOM output

Replace the current 5 separate `data-node-*` attributes with 2:

```html
<h1 data-node-id="components/Welcome.tsx:5:4"
    data-node-name="h1"
    class="font-display text-3xl font-semibold tracking-tight mb-3">
  Ready to Create
</h1>
```

- **`data-node-id`** — compact source locator: `file:line:col`
- **`data-node-name`** — element/component name for display

### 1. Update the Babel transform

**File:** `src/transforms/plugins/babel-node-positions.ts`

Rename `_options` to `options`. Replace the 5 separate attributes with 2:

```typescript
const nodeId = `${options.filePath}:${loc.start.line}:${loc.start.column}`;
const elementName = getElementName(openingElement);

openingElement.attributes.push(
  t.jsxAttribute(t.jsxIdentifier("data-node-id"), t.stringLiteral(nodeId)),
  t.jsxAttribute(t.jsxIdentifier("data-node-name"), t.stringLiteral(elementName)),
);
```

### 2. Update rehype/remark transforms for MDX/markdown

**Files:** `src/transforms/plugins/rehype-node-positions.ts`, `src/transforms/plugins/remark-node-id.ts`

Same pattern — inject `data-node-id="file:line:col"` and `data-node-name` instead of the separate `data-node-line`, `data-node-column`, etc. attributes. `rehype-node-positions.ts` already receives `filePath` in its options.

### 3. Update bridge constants

**File:** `src/studio/bridge/bridge-constants.ts`

```typescript
export const DATA_NODE_ID = "data-node-id";
export const DATA_NODE_NAME = "data-node-name";
```

### 4. Bridge parses compact ID

**File:** `src/studio/bridge/bridge-inspector.ts`

```typescript
function parseNodeId(el: Element): { path: string; line: number; col: number } | null {
  const nodeId = el.getAttribute(DATA_NODE_ID);
  if (!nodeId) return null;
  // "components/Welcome.tsx:5:4" → { path, line, col }
  const lastColon = nodeId.lastIndexOf(":");
  const secondLastColon = nodeId.lastIndexOf(":", lastColon - 1);
  if (secondLastColon === -1) return null;
  return {
    path: nodeId.slice(0, secondLastColon),
    line: parseInt(nodeId.slice(secondLastColon + 1, lastColon), 10),
    col: parseInt(nodeId.slice(lastColon + 1), 10),
  };
}
```

### 5. Bridge sends full node data with setSelectedNode

**File:** `src/studio/bridge/bridge-inspector.ts`

```typescript
const loc = parseNodeId(target);

postToStudio({
  action: "setSelectedNode",
  id: target.getAttribute(DATA_NODE_ID),
  node: {
    name: target.getAttribute(DATA_NODE_NAME) || target.tagName.toLowerCase(),
    type: getNodeType(target),
    path: loc?.path || getConfig().pagePath,
    line: loc?.line || 0,
    col: loc?.col || 0,
    text: target.textContent?.trim().slice(0, 200) || "",
  },
});
```

### 6. Remove dead code

- **`buildNavigatorTree`**, `sendTreeUpdate`, `setupMutationObserver`, `createTreeSignature`, `debouncedTreeUpdate` — build a full DOM tree on every mutation and post it to Studio via `treeUpdated`, but Studio never handles it. Dead code.
- **`DATA_VF_ID`** (`data-vf-id`) — defined in `bridge-constants.ts` and `types.ts`, read in `bridge-inspector.ts`, but **nothing ever writes it** to the DOM. Dead code.
- **`DATA_VF_TEXT`** (`data-vf-text`) — only used by `buildNavigatorTree` to detect text nodes. Dies with the tree.
- **`DATA_NODE_LINE`**, **`DATA_NODE_COLUMN`**, **`DATA_NODE_END_LINE`**, **`DATA_NODE_END_COLUMN`** — replaced by the compact `data-node-id="file:line:col"` format.

Keep:
- **`DATA_VF_IGNORE`** — actively used to mark overlays/carets so inspector skips them.
- **`DATA_VF_SELECTOR`** — runtime fallback ID for untransformed elements (third-party, framework).

## End-to-End Flow

```
Source: components/Welcome.tsx line 5
  <h1 className="...">Ready to Create</h1>

Compiled HTML (studio_embed=true):
  <h1 data-node-id="components/Welcome.tsx:5:4"
      data-node-name="h1"
      class="...">
    Ready to Create
  </h1>

User clicks h1 in inspect mode:
  bridge → postToStudio({
    action: "setSelectedNode",
    id: "components/Welcome.tsx:5:4",
    node: {
      name: "h1",
      type: "element",
      path: "components/Welcome.tsx",
      line: 5,
      col: 4,
      text: "Ready to Create",
    }
  })

Studio stores node, shows "h1" pill in chat, passes to chat agent:
  "The user selected <h1> in components/Welcome.tsx at line 5"
```

## Files Changed

| File | Change |
|------|--------|
| `src/transforms/plugins/babel-node-positions.ts` | Replace 5 `data-node-*` attrs with `data-node-id` + `data-node-name` |
| `src/studio/bridge/bridge-constants.ts` | Update `DATA_NODE_ID`; add `DATA_NODE_NAME`; remove old `DATA_NODE_LINE` etc. |
| `src/studio/bridge/bridge-inspector.ts` | Parse `data-node-id`, send full node data with `setSelectedNode` |

## What This Enables (in veryfront-studio)

1. **Store the selected node** with correct file + line info
2. **Show "h1" pill** in the chat inspect button (with x to deselect)
3. **Pass accurate context to the chat agent** via `useChatBody.ts`

## Migration

The old `data-node-*` attributes are only consumed by the bridge — no external dependencies. They can be removed in the same PR. The bridge's `findElementById`, `getElementId`, and overlay functions need updating to use `data-node-id`.

## Scope

- **DOM elements only** (`h1`, `div`, `p`, etc.) — no component-level tracking for now
- **TSX/JSX files** — via `babel-node-positions.ts`
- **MDX/markdown files** — via `rehype-node-positions.ts` and `remark-node-id.ts` (same `data-node-id="file:line:col"` + `data-node-name` format)

## Out of Scope

- Component selection (e.g. selecting `<Button>` and resolving to its source file)
- Third-party library elements
- Framework files (excluded by `isFrameworkFile` check)
