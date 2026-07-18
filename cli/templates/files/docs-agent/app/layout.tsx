'use client'

import "../globals.css";
import {
  AppShell,
  ChatSidebar,
  ChatThemeScope,
  ConversationsProvider,
  Tabs,
  TabsItem,
} from "veryfront/chat";
import { Head } from "veryfront/head";
import { useRouter } from "veryfront/router";

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  const router = useRouter();
  const activeTab = router.pathname.startsWith("/uploads") ? "uploads" : "chat";

  return (
    <>
      <Head><title>Docs Agent</title></Head>
      <ChatThemeScope className="flex flex-col h-screen">
        <ConversationsProvider storageKey="rag-conversations">
          <AppShell className="flex-1 min-h-0">
            <AppShell.Sidebar side="left" className="border-r border-[var(--outline-border)]">
              <AppShell.SidebarContent className="p-0">
                <ChatSidebar.Root>
                  <ChatSidebar.NewButton />
                  <ChatSidebar.List />
                </ChatSidebar.Root>
              </AppShell.SidebarContent>
            </AppShell.Sidebar>
            <AppShell.Main>
              <AppShell.Header border className="h-16 gap-3 px-3">
                <AppShell.Trigger side="left" />
                <div className="flex flex-1 justify-center">
                  <Tabs
                    value={activeTab}
                    onValueChange={(value) => router.push(value === "uploads" ? "/uploads" : "/")}
                  >
                    <TabsItem value="chat">Chat</TabsItem>
                    <TabsItem value="uploads">Uploads</TabsItem>
                  </Tabs>
                </div>
              </AppShell.Header>
              <AppShell.Content className="flex flex-col min-h-0 pt-3">
                {children}
              </AppShell.Content>
            </AppShell.Main>
          </AppShell>
        </ConversationsProvider>
      </ChatThemeScope>
    </>
  );
}
