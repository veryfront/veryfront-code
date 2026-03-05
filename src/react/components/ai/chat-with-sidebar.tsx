import * as React from "react";
import { cn, generateTokenCSS } from "./theme.ts";
import { Chat, type ChatProps } from "./chat/index.tsx";
import { ChatSidebar } from "./chat/components/sidebar.tsx";
import { type ChatTab, TabSwitcher } from "./chat/components/tab-switcher.tsx";
import { useThreads } from "./chat/hooks/use-threads.ts";
import { PanelLeftIcon } from "./icons/index.ts";

type ChatMessageSetter = (messages: ChatProps["messages"]) => void;
type ChatWithSidebarPassthroughProps = Omit<
  ChatProps,
  "messages" | "model" | "onModelChange" | "activeTab" | "onTabChange" | "className"
>;
type TabChangeHandler = NonNullable<ChatProps["onTabChange"]>;

export interface ChatWithSidebarChatController {
  messages: ChatProps["messages"];
  input: ChatProps["input"];
  onChange: ChatProps["onChange"];
  onSubmit?: ChatProps["onSubmit"];
  stop?: ChatProps["stop"];
  reload?: ChatProps["reload"];
  setInput?: ChatProps["setInput"];
  isLoading?: ChatProps["isLoading"];
  error?: ChatProps["error"];
  model?: ChatProps["model"];
  onModelChange?: ChatProps["onModelChange"];
  inferenceMode?: ChatProps["inferenceMode"];
  browserStatus?: ChatProps["browserStatus"];
  editMessage?: ChatProps["editMessage"];
  getBranches?: ChatProps["getBranches"];
  switchBranch?: ChatProps["switchBranch"];
  setMessages: ChatMessageSetter;
}

interface ChatWithSidebarSidebarBaseConfig {
  storageKey?: string;
  visible?: boolean;
}

export type ChatWithSidebarSidebarConfig =
  | (ChatWithSidebarSidebarBaseConfig & {
    open: boolean;
    onToggle: () => void;
  })
  | (ChatWithSidebarSidebarBaseConfig & {
    open?: undefined;
    onToggle?: () => void;
  });

export interface ChatWithSidebarModelConfig {
  options?: ChatProps["models"];
}

export interface ChatWithSidebarAttachmentConfig {
  accept?: ChatProps["attachAccept"];
  items?: ChatProps["attachments"];
  uploads?: ChatProps["uploads"];
  onAttach?: ChatProps["onAttach"];
  onDrop?: ChatProps["onDrop"];
  onRemoveItem?: ChatProps["onRemoveAttachment"];
  onRemoveUpload?: ChatProps["onRemoveUpload"];
}

export interface ChatWithSidebarQuickActionsConfig {
  suggestions?: ChatProps["suggestions"];
  onSuggestionClick?: ChatProps["onSuggestionClick"];
  actions?: ChatProps["quickActions"];
  onAction?: ChatProps["onQuickAction"];
}

export interface ChatWithSidebarMessageConfig {
  render?: ChatProps["renderMessage"];
  renderTool?: ChatProps["renderTool"];
  onFeedback?: ChatProps["onFeedback"];
  onSourceClick?: ChatProps["onSourceClick"];
}

export interface ChatWithSidebarFeatureConfig {
  steps?: ChatProps["showSteps"];
  tabs?: ChatProps["showTabs"];
  sources?: ChatProps["showSources"];
  export?: ChatProps["showExport"];
  scrollButton?: ChatProps["showScrollButton"];
  messageActions?: ChatProps["showMessageActions"];
}

export type ChatWithSidebarTabsConfig =
  | {
    active: ChatProps["activeTab"];
    onChange: TabChangeHandler;
  }
  | {
    active?: undefined;
    onChange?: TabChangeHandler;
  };

export interface ChatWithSidebarVoiceConfig {
  enabled?: ChatProps["enableVoice"];
  onVoice?: ChatProps["onVoice"];
}

export interface ChatWithSidebarGroupedProps {
  chat: ChatWithSidebarChatController;
  sidebar?: ChatWithSidebarSidebarConfig;
  models?: ChatWithSidebarModelConfig;
  attachments?: ChatWithSidebarAttachmentConfig;
  quickActions?: ChatWithSidebarQuickActionsConfig;
  message?: ChatWithSidebarMessageConfig;
  features?: ChatWithSidebarFeatureConfig;
  tabs?: ChatWithSidebarTabsConfig;
  voice?: ChatWithSidebarVoiceConfig;
  className?: string;
  maxHeight?: ChatProps["maxHeight"];
  theme?: ChatProps["theme"];
  placeholder?: ChatProps["placeholder"];
  emptyState?: ChatProps["emptyState"];
  children?: ChatProps["children"];
}

export type ChatWithSidebarProps = ChatWithSidebarGroupedProps;

export const ChatWithSidebar = React.forwardRef<HTMLDivElement, ChatWithSidebarProps>(
  function ChatWithSidebar(
    {
      chat,
      sidebar,
      models,
      attachments,
      quickActions,
      message,
      features,
      tabs,
      voice,
      className,
      maxHeight,
      theme,
      placeholder,
      emptyState,
      children,
    },
    ref,
  ): React.ReactElement {
    const storageKey = sidebar?.storageKey;
    const controlledOpen = sidebar?.open;
    const onSidebarToggle = sidebar?.onToggle;
    const showSidebar = sidebar?.visible ?? true;
    const setMessages = chat.setMessages;
    const messages = chat.messages;
    const model = chat.model;
    const onModelChange = chat.onModelChange;
    const controlledTab = tabs?.active;
    const chatProps: ChatWithSidebarPassthroughProps = {
      input: chat.input,
      onChange: chat.onChange,
      onSubmit: chat.onSubmit,
      stop: chat.stop,
      reload: chat.reload,
      setInput: chat.setInput,
      isLoading: chat.isLoading,
      error: chat.error,
      placeholder,
      maxHeight,
      theme,
      renderMessage: message?.render,
      renderTool: message?.renderTool,
      suggestions: quickActions?.suggestions,
      onSuggestionClick: quickActions?.onSuggestionClick,
      emptyState,
      showScrollButton: features?.scrollButton,
      showMessageActions: features?.messageActions,
      models: models?.options,
      inferenceMode: chat.inferenceMode,
      browserStatus: chat.browserStatus,
      showSources: features?.sources,
      onSourceClick: message?.onSourceClick,
      onAttach: attachments?.onAttach,
      onDrop: attachments?.onDrop,
      attachAccept: attachments?.accept,
      attachments: attachments?.items,
      onRemoveAttachment: attachments?.onRemoveItem,
      showExport: features?.export,
      onFeedback: message?.onFeedback,
      editMessage: chat.editMessage,
      getBranches: chat.getBranches,
      switchBranch: chat.switchBranch,
      showSteps: features?.steps,
      showTabs: features?.tabs,
      uploads: attachments?.uploads,
      onRemoveUpload: attachments?.onRemoveUpload,
      quickActions: quickActions?.actions,
      onQuickAction: quickActions?.onAction,
      enableVoice: voice?.enabled,
      onVoice: voice?.onVoice,
      children,
    };

    const {
      activeThreadId,
      createThread,
      deleteThread,
      renameThread,
      selectThread,
      threads,
      updateThread,
    } = useThreads({ storageKey });
    const [internalOpen, setInternalOpen] = React.useState(false);
    const [internalTab, setInternalTab] = React.useState<ChatTab>("chat");
    const showTabs = chatProps.showTabs ?? false;

    const isSidebarControlled = controlledOpen !== undefined;
    const sidebarOpen = isSidebarControlled ? controlledOpen : internalOpen;
    const toggleSidebar = React.useCallback(() => {
      if (isSidebarControlled) {
        onSidebarToggle?.();
        return;
      }

      setInternalOpen((prev) => {
        const next = !prev;
        onSidebarToggle?.();
        return next;
      });
    }, [isSidebarControlled, onSidebarToggle]);

    const isTabControlled = controlledTab !== undefined;
    const activeTab = controlledTab ?? internalTab;
    const handleTabChange = React.useCallback((tab: ChatTab) => {
      if (!isTabControlled) {
        setInternalTab(tab);
      }
      tabs?.onChange?.(tab);
    }, [isTabControlled, tabs]);

    // Keep refs in sync so callbacks always read current values
    const activeIdRef = React.useRef(activeThreadId);
    activeIdRef.current = activeThreadId;
    const messagesRef = React.useRef(messages);
    messagesRef.current = messages;
    const threadsRef = React.useRef(threads);
    threadsRef.current = threads;

    // Sync current messages to active thread on change
    const prevMessagesRef = React.useRef(messages);
    React.useEffect(() => {
      const currentActiveId = activeIdRef.current;
      if (!currentActiveId || messages === prevMessagesRef.current) return;
      prevMessagesRef.current = messages;

      if (messages.length > 0) {
        // Auto-title from first user message — combine with message sync
        // into a single updateThread call to avoid racing setThreads batches
        const activeThread = threadsRef.current.find((t) => t.id === currentActiveId);
        let title: string | undefined;
        if (activeThread?.title === "New Chat") {
          const firstUserMsg = messages.find((m) => m.role === "user");
          if (firstUserMsg) {
            const text = firstUserMsg.parts
              .filter((p) => p.type === "text")
              .map((p) => (p as { text: string }).text)
              .join("")
              .trim();
            if (text) title = text.slice(0, 30);
          }
        }

        updateThread(currentActiveId, title ? { messages, title } : { messages });
      }
    }, [messages, updateThread]);

    const handleSelectThread = React.useCallback(
      (id: string) => {
        const currentActiveId = activeIdRef.current;
        if (currentActiveId && messagesRef.current.length > 0) {
          updateThread(currentActiveId, { messages: messagesRef.current });
        }
        selectThread(id);
        const thread = threadsRef.current.find((t) => t.id === id);
        setMessages(thread?.messages ?? []);
      },
      [selectThread, updateThread, setMessages],
    );

    const handleNewThread = React.useCallback(() => {
      const currentActiveId = activeIdRef.current;
      if (currentActiveId && messagesRef.current.length > 0) {
        updateThread(currentActiveId, { messages: messagesRef.current });
      }
      const nextThread = createThread();
      setMessages(nextThread.messages);
    }, [createThread, updateThread, setMessages]);

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

    const tokenCSS = React.useMemo(() => generateTokenCSS(), []);

    return (
      <div
        ref={ref}
        className={cn("flex h-full bg-[var(--background)]", className)}
        data-vf-chat=""
      >
        <style dangerouslySetInnerHTML={{ __html: tokenCSS }} />
        {sidebarOpen && (
          <ChatSidebar
            threads={threads}
            activeThreadId={activeThreadId}
            onSelectThread={handleSelectThread}
            onDeleteThread={(id) => {
              deleteThread(id);
              const next = threadsRef.current.find((t) => t.id !== id);
              setMessages(next?.messages ?? []);
            }}
            onRenameThread={renameThread}
            onNewThread={handleNewThread}
          />
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center px-3 pt-4 pb-1 shrink-0">
            <button
              type="button"
              onClick={toggleSidebar}
              className="size-8 inline-flex items-center justify-center rounded-full text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--foreground)]/5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              <PanelLeftIcon className="size-[18px]" />
            </button>
            {showTabs && (
              <div className="flex-1 flex justify-center">
                <TabSwitcher activeTab={activeTab} onTabChange={handleTabChange} className="py-0" />
              </div>
            )}
            {showTabs && <div className="size-8 shrink-0" />}
          </div>
          <Chat
            messages={messages}
            model={model}
            onModelChange={onModelChange}
            className="flex-1 min-h-0"
            activeTab={activeTab}
            onTabChange={handleTabChange}
            hideTabSwitcher
            {...chatProps}
          />
        </div>
      </div>
    );
  },
);

ChatWithSidebar.displayName = "ChatWithSidebar";
