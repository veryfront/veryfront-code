# AppShell

Application shell layout — sidebar, main pane, header — from `veryfront/ui`. Chat consumes it; it does not own it.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Reference only

`AppShell` lives in **`veryfront/ui`**, not `veryfront/chat`. It is already shaped to the same convention this RFC applies to chat; chat compositions simply consume it. This page exists so the chat docs are complete — for full documentation, see the `veryfront/ui` reference.

## Anatomy

```tsx
import { AppShell } from 'veryfront/ui'

<AppShell>
  <AppShell.Sidebar>
    <AppShell.SidebarHeader />
    <AppShell.SidebarContent />
    <AppShell.SidebarFooter />
  </AppShell.Sidebar>
  <AppShell.Main>
    <AppShell.Header>
      <AppShell.Trigger />
    </AppShell.Header>
    <AppShell.Content />
  </AppShell.Main>
</AppShell>
```

## Parts

| Part | Purpose |
| --- | --- |
| `AppShell.Sidebar` | The sidebar region |
| `AppShell.SidebarHeader` | Sidebar header |
| `AppShell.SidebarContent` | Sidebar scrollable content |
| `AppShell.SidebarFooter` | Sidebar footer |
| `AppShell.Main` | The main pane |
| `AppShell.Header` | Main-pane header |
| `AppShell.Content` | Main-pane content |
| `AppShell.Trigger` | Toggles the sidebar |

## Used with chat

A typical chat workspace places [`ChatSidebar`](./chat-sidebar.md) in the sidebar and the chat surface in the main pane:

```tsx
<ConversationsProvider storageKey="ops">
  <AppShell>
    <AppShell.Sidebar><ChatSidebar /></AppShell.Sidebar>
    <AppShell.Main>
      <Chat agentId="support-agent" api="/api/ag-ui" uploadApi="/api/uploads" />
    </AppShell.Main>
  </AppShell>
</ConversationsProvider>
```

## Related

- [`useAppShell`](../hooks/use-app-shell.md) — shell state hook.
- [`useColorMode` / `ColorModeProvider` / `ColorModeToggle`](../hooks/use-color-mode.md) — color mode, also from `veryfront/ui`, documented as-is.
