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

We use explicit, separate attributes — no encoding, no parsing needed.

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
// module-server.ts — sourceFile is absolute (join(projectDir, ...))
injectNodePositions(source, { filePath: sourceFile })

// component-handling.ts — entity.path is project-relative
injectNodePositions(rawFileContent, { filePath: pageInfo.entity.path })
```

The browser loader already propagates `studio_embed=true` to all imported module requests, so `components/Welcome.tsx` already gets transformed — it just doesn't inject the file path.

For MDX/markdown: `rehype-node-positions.ts` already injects `data-node-file` when `filePath` is provided. `remark-node-id.ts` does **not** accept `filePath` — its interface only has `{ prefix?, includePosition? }` and would need extending.

## Proposal

### Target DOM output

Add `data-node-file` and `data-node-name` to the existing attributes:

```html
<h1 data-node-file="components/Welcome.tsx"
    data-node-name="h1"
    data-node-id="node-3"
    data-node-line="5"
    data-node-column="4"
    data-node-end-line="7"
    data-node-end-column="10"
    class="font-display text-3xl font-semibold tracking-tight mb-3">
  Ready to Create
</h1>
```

- **`data-node-file`** — project-relative source file path
- **`data-node-name`** — element or component name for display in Studio UI
- **`data-node-id`**, **`data-node-line`**, **`data-node-column`**, etc. — unchanged

### 1. Normalize file paths to project-relative

**File:** `src/transforms/plugins/babel-node-positions.ts`

`module-server.ts` passes absolute paths (e.g. `/app/projects/abc/components/Welcome.tsx`). `component-handling.ts` passes project-relative paths (e.g. `components/Welcome.tsx`). Normalize to project-relative before injection.

Either:
- **a)** Normalize inside `injectNodePositions` — strip `projectDir` prefix if present
- **b)** Normalize at the call site in `module-server.ts` before passing to the transform

Option (b) is cleaner — the transform shouldn't need to know about `projectDir`.

### 2. Update the Babel transform

**File:** `src/transforms/plugins/babel-node-positions.ts`

Rename `_options` to `options`. Add `data-node-file` and `data-node-name`:

```typescript
const elementName = getElementName(openingElement);

openingElement.attributes.push(
  t.jsxAttribute(t.jsxIdentifier("data-node-file"), t.stringLiteral(options.filePath)),
  t.jsxAttribute(t.jsxIdentifier("data-node-name"), t.stringLiteral(elementName)),
  // existing attributes unchanged:
  t.jsxAttribute(t.jsxIdentifier("data-node-id"), t.stringLiteral(nodeId)),
  t.jsxAttribute(t.jsxIdentifier("data-node-line"), t.stringLiteral(String(loc.start.line))),
  t.jsxAttribute(t.jsxIdentifier("data-node-column"), t.stringLiteral(String(loc.start.column))),
);
```

Skip injection if `options.filePath` is falsy (guard against `undefined`/empty string).

### 3. Update rehype transform for MDX/markdown

**File:** `src/transforms/plugins/rehype-node-positions.ts`

Already injects `data-node-file` when `filePath` is provided. Add `data-node-name` (tag name or MDX component name). Verify it's being called with `filePath` in studio embed mode.

### 4. Update remark transform for markdown

**File:** `src/transforms/plugins/remark-node-id.ts`

Currently only accepts `{ prefix?, includePosition? }`. Extend its interface to accept `filePath` and inject `data-node-file` alongside existing attributes. Update call sites to pass `filePath`.

### 5. Add bridge constant

**File:** `src/studio/bridge/bridge-constants.ts`

```typescript
export const DATA_NODE_FILE = "data-node-file";
export const DATA_NODE_NAME = "data-node-name";
```

### 6. Bridge reads per-element file path

**File:** `src/studio/bridge/bridge-inspector.ts`

The bridge reads `data-node-file` from each element — no parsing needed.

### 7. Bridge sends full node data with setSelectedNode

**File:** `src/studio/bridge/bridge-inspector.ts`

Enhance the click handler to send node metadata alongside the ID:

```typescript
postToStudio({
  action: "setSelectedNode",
  id: id,
  node: {
    name: target.getAttribute(DATA_NODE_NAME) || target.tagName.toLowerCase(),
    type: getNodeType(target),
    file: target.getAttribute(DATA_NODE_FILE) || getConfig().pagePath,
    line: parseInt(target.getAttribute(DATA_NODE_LINE) || "0", 10),
    column: parseInt(target.getAttribute(DATA_NODE_COLUMN) || "0", 10),
    text: target.textContent?.trim().slice(0, 200) || "",
  },
});
```

### 8. Update `setSelectedNode` schema

**File:** `src/studio/schemas/studio.schema.ts`

The `MessageFromRenderer` schema for `setSelectedNode` currently only accepts `{ action, id }`. Add optional `node` object:

```typescript
z.object({
  action: z.literal("setSelectedNode"),
  id: z.string(),
  node: z.object({
    name: z.string(),
    type: z.string(),
    file: z.string(),
    line: z.number(),
    column: z.number(),
    text: z.string(),
  }).optional(),
}),
```

## End-to-End Flow

```
Source: components/Welcome.tsx line 5
  <h1 className="...">Ready to Create</h1>

Compiled HTML (studio_embed=true):
  <h1 data-node-file="components/Welcome.tsx"
      data-node-name="h1"
      data-node-id="node-3"
      data-node-line="5"
      data-node-column="4"
      class="...">
    Ready to Create
  </h1>

User clicks h1 in inspect mode:
  bridge → postToStudio({
    action: "setSelectedNode",
    id: "node-3",
    node: {
      name: "h1",
      type: "element",
      file: "components/Welcome.tsx",
      line: 5,
      column: 4,
      text: "Ready to Create",
    }
  })

Studio stores node, shows "h1" pill in chat, passes to chat agent:
  "The user selected <h1> in components/Welcome.tsx at line 5"
```

## Files Changed

| File | Change |
|------|--------|
| `src/modules/server/module-server.ts` | Normalize `sourceFile` to project-relative before passing to transform |
| `src/transforms/plugins/babel-node-positions.ts` | Rename `_options` → `options`; inject `data-node-file` + `data-node-name`; guard falsy `filePath` |
| `src/transforms/plugins/rehype-node-positions.ts` | Add `data-node-name`; verify `filePath` is passed in studio embed mode |
| `src/transforms/plugins/remark-node-id.ts` | Extend interface to accept `filePath`; inject `data-node-file` |
| `src/studio/bridge/bridge-constants.ts` | Add `DATA_NODE_FILE`, `DATA_NODE_NAME` |
| `src/studio/bridge/bridge-inspector.ts` | Read `data-node-file` per element; send full node data with `setSelectedNode` |
| `src/studio/schemas/studio.schema.ts` | Add optional `node` object to `setSelectedNode` message schema |

## What This Enables (in veryfront-studio)

1. **Store the selected node** with correct file + line info
2. **Show "h1" pill** in the chat inspect button (with x to deselect)
3. **Pass accurate context to the chat agent** via `useChatBody.ts`

## Scope

- **DOM elements only** (`h1`, `div`, `p`, etc.) — no component-level tracking for now
- **TSX/JSX files** — via `babel-node-positions.ts`
- **MDX/markdown files** — via `rehype-node-positions.ts` and `remark-node-id.ts`

## Out of Scope

- Dead code removal (`data-vf-id`, `buildNavigatorTree`, etc.) — separate PR, see RFC 002
- Component selection (e.g. selecting `<Button>` and resolving to its source file)
- Third-party library elements
- Framework files (excluded by `isFrameworkFile` check)
