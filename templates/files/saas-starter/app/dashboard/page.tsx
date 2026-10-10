"use client";

import { AppShell, Chat, ChatSidebar, ChatThemeScope, ConversationsProvider } from "veryfront/chat";
import { MarkdownRendererProvider } from "veryfront/markdown";
import { MarkdownRenderer } from "../markdown-renderer.tsx";

export default function Dashboard(): React.JSX.Element {
  return (
    <ChatThemeScope className="flex h-screen bg-white dark:bg-neutral-950">
      <ConversationsProvider storageKey="saas-conversations">
        <AppShell className="flex-1 min-h-0">
          <AppShell.Sidebar
            side="left"
            width={256}
            className="border-r border-[var(--outline-border)] bg-neutral-50 dark:bg-neutral-900"
          >
            <AppShell.SidebarContent className="p-0">
              <ChatSidebar.Root>
                <ChatSidebar.NewButton />
                <ChatSidebar.List />
              </ChatSidebar.Root>
            </AppShell.SidebarContent>
            <AppShell.SidebarFooter border className="p-4">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-full bg-neutral-200 text-xs font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                  U
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">
                    Demo user
                  </p>
                  <p className="truncate text-xs text-neutral-500">
                    demo@example.com
                  </p>
                </div>
              </div>
            </AppShell.SidebarFooter>
          </AppShell.Sidebar>

          <AppShell.Main>
            <AppShell.Header border className="h-14 gap-3 px-3">
              <AppShell.Trigger side="left" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">
                  AI SaaS Assistant
                </p>
              </div>
            </AppShell.Header>
            <AppShell.Content className="flex min-h-0 flex-col">
              <MarkdownRendererProvider renderer={MarkdownRenderer}>
                <Chat
                  agentId="assistant"
                  api="/api/ag-ui"
                  className="flex-1 min-h-0"
                  placeholder="Message..."
                />
              </MarkdownRendererProvider>
            </AppShell.Content>
          </AppShell.Main>
        </AppShell>
      </ConversationsProvider>
    </ChatThemeScope>
  );
}
