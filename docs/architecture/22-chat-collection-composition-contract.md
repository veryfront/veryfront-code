# Chat collection composition contract

This page documents the internal composition contract used by current
`veryfront/chat` collection components. It describes implemented behavior and
the checks that protect it; it is not a roadmap for every list-like component.

## Responsibility

The contract keeps preset and composed collection rendering on one
implementation. A consumer can use the default collection, replace the list
anatomy, or read the collection state through a hook without losing the owning
component's behavior.

The shared conformance suite currently covers `Sources` and
`AttachmentsPanel`. Message parts expose a related headless/composed surface
through `useMessageParts`, `Message.Content`, and `Message.Part`, with separate
tests.

## Primary source areas

- [`components/sources.tsx`](../../src/react/components/chat/chat/components/sources.tsx)
  is the reference implementation.
- [`components/attachments-panel.tsx`](../../src/react/components/chat/chat/components/attachments-panel.tsx)
  is the second implementation covered by the shared contract.
- [`collections.contract.test.tsx`](../../src/react/components/chat/chat/collections.contract.test.tsx)
  owns the cross-component conformance checks.
- [`composition/message.tsx`](../../src/react/components/chat/chat/composition/message.tsx)
  owns composed message-part rendering.
- [`contexts/message-context.tsx`](../../src/react/components/chat/chat/contexts/message-context.tsx)
  owns the headless message-parts hook.

## Collection shape

Participating collection `X` components expose four cooperating surfaces:

| Surface | Shape                                                | Responsibility                                                                     |
| ------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Root    | `<X>` and `<X.Root>`                                 | Provides context and renders the default anatomy when children are omitted.        |
| Data    | `useX()`                                             | Reads the enclosing collection state and fails outside its provider.               |
| List    | `<X.List>`                                           | Reads collection context and maps the default item leaf when children are omitted. |
| Item    | `<X.Item>` or a domain name such as `<Sources.Pill>` | Renders one addressable collection entry.                                          |

`Sources` uses this flow:

```text
Sources / Sources.Root
  -> SourcesContext
  -> Sources.List
  -> Sources.Pill
```

`Sources.Root` renders `Sources.List` when it has no children.
`Sources.List` renders one `Sources.Pill` for each source when it has no
children. Supplying children at either tier replaces that tier's default
anatomy while preserving the context boundary.

## Invariants

- The preset and composed forms delegate to the same root, list, and item
  implementation.
- The data hook throws when it is used outside the corresponding root.
- Omitting children renders the default anatomy; supplying children replaces
  that anatomy at the selected tier.
- Each addressable tier owns its root `className` instead of receiving nested
  style-prop bags from its parent.
- Data-list render callbacks use `renderItem({ item, index })` when a callback
  is needed. Static structure uses compound children.
- Collection-specific behavior stays in context or the item leaf so replacing
  one visual tier does not create a second state path.

## Boundaries

The shared contract does not claim that every list in `veryfront/chat` exports
the same names. Existing domain names such as `Sources.Pill` remain valid, and
components outside the shared conformance suite keep their focused contracts.
Expanding the shared contract requires adding the component to
`collections.contract.test.tsx` in the same change.

Public component signatures are documented in the generated
[`veryfront/chat` API reference](../api-reference/veryfront/chat.md). This page
owns only the internal composition and verification boundary.

## Change checks

Run these checks after changing a participating collection or its context:

```bash
deno test --allow-all src/react/components/chat/chat/collections.contract.test.tsx
deno task lint:chat-ratchets
deno task typecheck:consumer
```

Also run the focused component tests for the changed collection.

## Related documentation

- [Build a chat UI](../guides/chat-ui.md)
- [Chat hooks](../guides/chat-hooks.md)
- [`veryfront/chat` API reference](../api-reference/veryfront/chat.md)
