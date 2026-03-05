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
      setModel,
      ...chatProps
    },
    ref,
  ): React.ReactElement {
    const modelChangeHandler = onModelChange ?? (setModel as ((model: string) => void) | undefined);
    const threadsHook = useThreads({ storageKey });
    const [internalOpen, setInternalOpen] = React.useState(true);

    const isControlled = controlledOpen !== undefined;
    const sidebarOpen = isControlled ? controlledOpen : internalOpen;
    const toggleSidebar = isControlled
      ? controlledToggle!
      : () => setInternalOpen((prev) => !prev);

    // Sync current messages to active thread on change
    const activeId = threadsHook.activeThreadId;
    const prevMessagesRef = React.useRef(messages);
    React.useEffect(() => {
      if (!activeId || messages === prevMessagesRef.current) return;
      prevMessagesRef.current = messages;

      if (messages.length > 0) {
        threadsHook.updateThread(activeId, { messages });

        // Auto-title from first user message
        const activeThread = threadsHook.threads.find((t) => t.id === activeId);
        if (activeThread?.title === "New Chat") {
          const firstUserMsg = messages.find((m) => m.role === "user");
          if (firstUserMsg) {
            const text = firstUserMsg.parts
              .filter((p) => p.type === "text")
              .map((p) => (p as { text: string }).text)
              .join("")
              .trim();
            if (text) {
              threadsHook.renameThread(activeId, text.slice(0, 30));
            }
          }
        }
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages]);

    const handleSelectThread = React.useCallback(
      (id: string) => {
        if (activeId && messages.length > 0) {
          threadsHook.updateThread(activeId, { messages });
        }
        threadsHook.selectThread(id);
        const thread = threadsHook.threads.find((t) => t.id === id);
        if (thread && setMessages) {
          setMessages(thread.messages);
        }
      },
      [activeId, messages, threadsHook, setMessages],
    );

    const handleNewThread = React.useCallback(() => {
      if (activeId && messages.length > 0) {
        threadsHook.updateThread(activeId, { messages });
      }
      threadsHook.createThread();
      if (setMessages) setMessages([]);
    }, [activeId, messages, threadsHook, setMessages]);

    if (!showSidebar) {
      return <Chat ref={ref} messages={messages} model={model} className={className} {...chatProps} />;
    }

    return (
      <div ref={ref} className={cn("flex h-full", className)}>
        {sidebarOpen && (
          <ChatSidebar
            threads={threadsHook.threads}
            activeThreadId={threadsHook.activeThreadId}
            onSelectThread={handleSelectThread}
            onNewThread={handleNewThread}
            onDeleteThread={(id) => {
              threadsHook.deleteThread(id);
              const next = threadsHook.threads.find((t) => t.id !== id);
              if (next && setMessages) setMessages(next.messages);
            }}
            onRenameThread={threadsHook.renameThread}
          />
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Header bar with toggle — always outside the sidebar */}
          <div className="flex items-center gap-1 px-3 py-2 shrink-0 border-b border-neutral-100 dark:border-neutral-800/60">
            <button
              type="button"
              onClick={toggleSidebar}
              className="p-2 rounded-lg text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              <PanelLeftIcon className="size-5" />
            </button>
            <button
              type="button"
              onClick={handleNewThread}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              <PlusIcon className="size-4" />
              <span>New Chat</span>
            </button>
            {models && models.length > 0 && modelChangeHandler && (
              <>
                <div className="flex-1" />
                <ModelSelector
                  models={models}
                  value={model}
                  onChange={modelChangeHandler}
                />
              </>
            )}
          </div>
          <Chat messages={messages} model={model} className="flex-1 min-h-0" {...chatProps} />
        </div>
      </div>
    );
  },
);

ChatWithSidebar.displayName = "ChatWithSidebar";
