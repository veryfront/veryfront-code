import * as React from "react";
import { cn } from "./theme.ts";
import { Chat, type ChatProps } from "./chat/index.tsx";
import { ChatSidebar } from "./chat/components/sidebar.tsx";
import { useThreads } from "./chat/hooks/use-threads.ts";
import { PanelLeftIcon, PlusIcon } from "./icons/index.ts";
import { ModelSelector } from "./model-selector.tsx";

export interface ChatWithSidebarProps extends ChatProps {
  /** localStorage key prefix for thread persistence */
  storageKey?: string;
  /** Controlled sidebar open state */
  sidebarOpen?: boolean;
  /** Called when sidebar toggles */
  onSidebarToggle?: () => void;
  /** Show sidebar (default: true) */
  showSidebar?: boolean;
  /** Set messages externally (needed for thread switching) */
  setMessages?: (messages: ChatProps["messages"]) => void;
}

export const ChatWithSidebar = React.forwardRef<HTMLDivElement, ChatWithSidebarProps>(
  function ChatWithSidebar(
    {
      storageKey,
      sidebarOpen: controlledOpen,
      onSidebarToggle: controlledToggle,
      showSidebar = true,
      setMessages,
      className,
      messages,
      models,
      model,
      onModelChange,
      ...chatProps
    },
    ref,
  ): React.ReactElement {
    const threadsHook = useThreads({ storageKey });
    const [internalOpen, setInternalOpen] = React.useState(true);

    const isControlled = controlledOpen !== undefined;
    const sidebarOpen = isControlled ? controlledOpen : internalOpen;
    const toggleSidebar = isControlled ? controlledToggle! : () => setInternalOpen((prev) => !prev);

    // Keep refs in sync so callbacks always read current values
    const activeId = threadsHook.activeThreadId;
    const activeIdRef = React.useRef(activeId);
    activeIdRef.current = activeId;
    const messagesRef = React.useRef(messages);
    messagesRef.current = messages;
    const threadsHookRef = React.useRef(threadsHook);
    threadsHookRef.current = threadsHook;

    // Sync current messages to active thread on change
    const prevMessagesRef = React.useRef(messages);
    React.useEffect(() => {
      const currentActiveId = activeIdRef.current;
      if (!currentActiveId || messages === prevMessagesRef.current) return;
      prevMessagesRef.current = messages;

      if (messages.length > 0) {
        threadsHookRef.current.updateThread(currentActiveId, { messages });

        // Auto-title from first user message
        const activeThread = threadsHookRef.current.threads.find((t) => t.id === currentActiveId);
        if (activeThread?.title === "New Chat") {
          const firstUserMsg = messages.find((m) => m.role === "user");
          if (firstUserMsg) {
            const text = firstUserMsg.parts
              .filter((p) => p.type === "text")
              .map((p) => (p as { text: string }).text)
              .join("")
              .trim();
            if (text) {
              threadsHookRef.current.renameThread(currentActiveId, text.slice(0, 30));
            }
          }
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages]);

    const handleSelectThread = React.useCallback(
      (id: string) => {
        const currentActiveId = activeIdRef.current;
        if (currentActiveId && messagesRef.current.length > 0) {
          threadsHookRef.current.updateThread(currentActiveId, { messages: messagesRef.current });
        }
        threadsHookRef.current.selectThread(id);
        const thread = threadsHookRef.current.threads.find((t) => t.id === id);
        if (thread && setMessages) {
          setMessages(thread.messages);
        }
      },
      [setMessages],
    );

    const handleNewThread = React.useCallback(() => {
      const currentActiveId = activeIdRef.current;
      if (currentActiveId && messagesRef.current.length > 0) {
        threadsHookRef.current.updateThread(currentActiveId, { messages: messagesRef.current });
      }
      threadsHookRef.current.createThread();
      if (setMessages) setMessages([]);
    }, [setMessages]);

    if (!showSidebar) {
      return (
        <Chat
          ref={ref}
          messages={messages}
          model={model}
          onModelChange={onModelChange}
          className={className}
          {...chatProps}
        />
      );
    }

    return (
      <div ref={ref} className={cn("flex h-full", className)}>
        {sidebarOpen && (
          <ChatSidebar
            threads={threadsHook.threads}
            activeThreadId={threadsHook.activeThreadId}
            onSelectThread={handleSelectThread}
            onDeleteThread={(id) => {
              threadsHookRef.current.deleteThread(id);
              const next = threadsHookRef.current.threads.find((t) => t.id !== id);
              if (next && setMessages) setMessages(next.messages);
            }}
            onRenameThread={threadsHook.renameThread}
          />
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-1 px-3 py-2 shrink-0 border-b border-[var(--border)]">
            <button
              type="button"
              onClick={toggleSidebar}
              className="size-9 inline-flex items-center justify-center rounded-full text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--foreground)]/5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              <PanelLeftIcon className="size-5" />
            </button>
            <button
              type="button"
              onClick={handleNewThread}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium text-[var(--foreground)] hover:bg-[var(--foreground)]/5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
            >
              <PlusIcon className="size-4" />
              <span>New Chat</span>
            </button>
            {models && models.length > 0 && onModelChange && (
              <>
                <div className="flex-1" />
                <ModelSelector
                  models={models}
                  value={model}
                  onChange={onModelChange}
                />
              </>
            )}
          </div>
          <Chat
            messages={messages}
            model={model}
            onModelChange={onModelChange}
            className="flex-1 min-h-0"
            {...chatProps}
          />
        </div>
      </div>
    );
  },
);

ChatWithSidebar.displayName = "ChatWithSidebar";
