# RFC 29 — `veryfront/chat` API shape: implementation spec

**Layer definition of done for `veryfront/chat`.** Distilled from the approved plan
(`snappy-wibbling-quokka.md`) — sections "Quality gates", the "Hard rules" framing, and the
Phase-3 reconciliation. This is the source of truth for when a `veryfront/chat` component or
hook is "done". Do not add requirements beyond what the RFC (#2980) and plan state.

## Framing: this is a composition-contract rewrite, not a feature rewrite

#2980 is **not** a feature rewrite — it is a **composition-contract rewrite**. Behaviour /
feature presence mostly already exists (real code with colocated `.test.tsx` and a
`composability.contract.test.tsx`). The work is to **reconcile the actual code to the
documented API**, fill naming gaps, and run every piece through the gates.

Re-expressing every part as **one `forwardRef` node + `{...props}`**, deleting the prop bags
and hidden wrappers, is the **bulk of Phase 3** — a structural rewrite of the composition
surface on top of behaviour / state (hooks, contexts) that mostly already exists. "Behavior
matches" in the recon table means *logic is reusable*, **not** "already conforms": nearly every
non-`cut` row still owes the full one-node / `forwardRef` / no-bags rewrite plus its matrix
gates.

## Hard rules (normative — apply to nearly every component)

1. **No `xxxClassName` / `xxxProps` bags** — one `className` per node. (In the ledger to drop,
   e.g. `icons={{}}` / `xxxClassName` bags.)
2. **No hidden DOM** — one element per part, or merge onto yours via `asChild`. Today's
   components carry hidden wrapper divs (rule 10 names `ChatInput`'s centering div and
   `ChatRoot`'s container); these are deleted with a parity snapshot proving the pixels.
3. **Renders exactly one node** (or zero + context).
4. **All `forwardRef`** — `ref` reaches that single node.
5. Every part **spreads `{...props}`**.
6. **Nested nodes are composed by you** — no escape-hatch props.
7. **`asChild`** swaps the element and re-merges correctly.
8. **`data-*` state, not booleans** — declared `data-*` states appear / disappear with state.
9. **Merge semantics** (normative, conformance-tested): handlers compose (consumer first,
   `preventDefault` cancels the internal handler); `className` via `cx` (clsx + tailwind-merge),
   consumer beats variant default; refs compose; `getXProps(overrides?)` takes overrides;
   `mergeProps` is public API.

Breaking changes (removals / relocations / renames) all ship in the **one batched breaking
release** (RFC rule 8 ledger).

## Per-component conformance checklist (the 9-point harness)

One shared conformance harness; **every component registers**. Each row must pass:

1. Renders exactly **one** node (or zero + context).
2. `className` merges Tailwind-aware — consumer beats variant default.
3. Arbitrary `data-*` / `aria-*` spread through.
4. Consumer handler **and** internal handler both fire — consumer first, `preventDefault`
   cancels.
5. `asChild` swaps the element and re-merges correctly.
6. `ref` reaches the node.
7. Declared `data-*` states appear / disappear with state.
8. a11y row: role, accessible name, keyboard reachable.
9. **Default-render parity** — childless / L1 render produces the **identical DOM tree +
   classes as today** (DOM snapshot pinned); only deltas explicitly badged `changed` are
   allowed.

## Per-hook requirement (behaviour tests)

Each hook owes a **behaviour test**: state machine + getters. Examples from the RFC —
`useChatInput` fold / guard / clear / IME / controlled; attachments lifecycle;
`useChatScroll` escape / resume + prepend-preserve; `useToolCall` full `data-state` walk incl.
approval. Hooks have **no** Story / Styled of their own — they're covered by their component's
stories and default-render parity.

## Per-domain integration tests (a few)

Composer round-trip; abort mid-stream; thread-switch mid-stream (survives + persists to the
right thread); upload E2E; edit-and-branch.

## Storybook gate

Every `chat` component has stories covering its documented states — the `data-*` vocabulary
drives the story matrix.

## The 6 gate columns (definition of done)

A piece is "done" only when **every** column is checked.

| Col | Meaning |
|---|---|
| **Spec** | Ticket written; API shape locked to the #2980 doc page |
| **Built** | Worked-through: single-node, `asChild`, `{...props}`, `data-*`, hook-driven — matches doc |
| **Story** | Storybook stories cover documented states (`n/a` for hooks) |
| **Test** | Conformance-harness registration (components) or behaviour test (hooks) green |
| **Styled** | Default-render parity — identical DOM / classes as today, or badged `changed` (`n/a` for hooks) |
| **Verified** | Green end-to-end in the validation loop / example repo |

## Reuse the existing rig (invent no harness)

Definition-of-done reuses what exists:

- `composability.contract.test.tsx` **COMPOUNDS registry** — grow from 11 to **every**
  compound.
- `collections.contract.test.tsx`.
- Colocated `*.test.tsx`.
- `chat.characterization.test.tsx` **DOM snapshots** — pin rule-10 pixel parity: deleted
  wrappers reappear as explicit markup.

## Step zero

RFC 29 docs live only on branch `rfc/chat-api-shape`; code is on `main`. Land the docs onto
the working branch (or read cross-branch via `git show rfc/chat-api-shape:<path>`) — they are
the canonical reference for "done".

## Layer sign-off (from "Verification")

- `composability.contract.test.tsx` covers **every** compound.
- Per-hook behaviour tests + per-domain integration tests green.
- Portalled surfaces stay inside `[data-vf-ui]` / `[data-vf-chat]` in both builtin and Base UI
  paths.
