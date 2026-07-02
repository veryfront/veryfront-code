import * as React from "react";
import { getDocumentNonce } from "./csp-nonce.ts";
import { cn, generateTokenCSS } from "./theme.ts";
import { Chat, type ChatProps } from "./chat/index.tsx";
import { ChatSidebar } from "./chat/components/sidebar.tsx";
import { type ChatTab, TabSwitcher } from "./chat/components/tab-switcher.tsx";
import { useThreads } from "./chat/hooks/use-threads.ts";
import { AppShell, useAppShell } from "./ui/index.ts";

type ChatMessageSetter = (messages: NonNullable<ChatProps["messages"]>) => void;
type ChatWithSidebarPassthroughProps = Omit<
  ChatProps,
  | "messages"
  | "model"
  | "onModelChange"
  | "activeTab"
  | "onTabChange"
  | "className"
>;
type TabChangeHandler = NonNullable<ChatProps["onTabChange"]>;

/** Public API contract for chat with sidebar chat controller. */
export interface ChatWithSidebarChatController {
  messages: NonNullable<ChatProps["messages"]>;
  input: NonNullable<ChatProps["input"]>;
  onChange: NonNullable<ChatProps["onChange"]>;
  onSubmit?: ChatProps["onSubmit"];
  stop?: ChatProps["stop"];
  reload?: ChatProps["reload"];
  setInput?: ChatProps["setInput"];
  isLoading?: ChatProps["isLoading"];
  error?: ChatProps["error"];
  model?: ChatProps["model"];
  activeModel?: ChatProps["activeModel"];
  onModelChange?: ChatProps["onModelChange"];
  inferenceMode?: ChatProps["inferenceMode"];
  editMessage?: ChatProps["editMessage"];
  getBranches?: ChatProps["getBranches"];
  switchBranch?: ChatProps["switchBranch"];
  setMessages: ChatMessageSetter;
}

interface ChatWithSidebarSidebarBaseConfig {
  storageKey?: string;
  visible?: boolean;
}

/** Configuration used by chat with sidebar sidebar. */
export type ChatWithSidebarSidebarConfig =
  | (ChatWithSidebarSidebarBaseConfig & {
    open: boolean;
    onToggle: () => void;
  })
  | (ChatWithSidebarSidebarBaseConfig & {
    open?: undefined;
    onToggle?: () => void;
  });

/** Configuration used by chat with sidebar model. */
export interface ChatWithSidebarModelConfig {
  options?: ChatProps["models"];
}

/** Configuration used by chat with sidebar attachment. */
export interface ChatWithSidebarAttachmentConfig {
  accept?: ChatProps["attachAccept"];
  items?: ChatProps["attachments"];
  uploads?: ChatProps["uploads"];
  onAttach?: ChatProps["onAttach"];
  onDrop?: ChatProps["onDrop"];
  onRemoveItem?: ChatProps["onRemoveAttachment"];
  onRemoveUpload?: ChatProps["onRemoveUpload"];
}

/** Configuration used by chat with sidebar quick actions. */
export interface ChatWithSidebarQuickActionsConfig {
  suggestions?: ChatProps["suggestions"];
  onSuggestionClick?: ChatProps["onSuggestionClick"];
  actions?: ChatProps["quickActions"];
  onAction?: ChatProps["onQuickAction"];
}

/** Configuration used by chat with sidebar message. */
export interface ChatWithSidebarMessageConfig {
  render?: ChatProps["renderMessage"];
  renderTool?: ChatProps["renderTool"];
  onFeedback?: ChatProps["onFeedback"];
  onSourceClick?: ChatProps["onSourceClick"];
}

/** Configuration used by chat with sidebar feature. */
export interface ChatWithSidebarFeatureConfig {
  steps?: ChatProps["showSteps"];
  tabs?: ChatProps["showTabs"];
  sources?: ChatProps["showSources"];
  export?: ChatProps["showExport"];
  scrollButton?: ChatProps["showScrollButton"];
  messageActions?: ChatProps["showMessageActions"];
}

/** Configuration used by chat with sidebar tabs. */
export type ChatWithSidebarTabsConfig =
  | {
    active: ChatProps["activeTab"];
    onChange: TabChangeHandler;
  }
  | {
    active?: undefined;
    onChange?: TabChangeHandler;
  };

/** Configuration used by chat with sidebar voice. */
export interface ChatWithSidebarVoiceConfig {
  enabled?: ChatProps["enableVoice"];
  onVoice?: ChatProps["onVoice"];
}

/** Props accepted by chat with sidebar grouped. */
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
  /**
   * Wraps the internal new-thread handler. Runs before the internal action;
   * return `false` to skip creating a thread.
   */
  onNewThread?: () => void | false;
  /**
   * Wraps the internal select-thread handler. Runs before the internal action;
   * return `false` to skip selecting the thread.
   */
  onSelectThread?: (threadId: string) => void | false;
  /**
   * Wraps the internal delete-thread handler. Runs before the internal action;
   * return `false` to skip deleting the thread.
   */
  onDeleteThread?: (threadId: string) => void | false;
  /** Replaces the hardcoded header bar when provided. */
  renderHeader?: (opts: { onToggleSidebar: () => void }) => React.ReactNode;
  /** Overrides the built-in PanelLeftIcon on the sidebar-toggle button. */
  toggleIcon?: React.ReactNode;
}

/** Props accepted by chat with sidebar. */
export type ChatWithSidebarProps = ChatWithSidebarGroupedProps;

interface ShellHeaderProps {
  renderHeader?: ChatWithSidebarGroupedProps["renderHeader"];
  toggleIcon?: React.ReactNode;
  showTabs: boolean;
  activeTab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
}

/**
 * Header bar rendered inside the AppShell so it can drive the sidebar toggle via
 * context. Falls back to the consumer's `renderHeader` when provided.
 */
function ShellHeader({
  renderHeader,
  toggleIcon,
  showTabs,
  activeTab,
  onTabChange,
}: ShellHeaderProps): React.ReactElement {
  const { toggle } = useAppShell();
  if (renderHeader) {
    return <>{renderHeader({ onToggleSidebar: () => toggle("left") })}</>;
  }
  return (
    <AppShell.Header className="pt-4! pb-1!">
      <AppShell.Trigger
        side="left"
        icon={toggleIcon}
        className="text-[var(--faint)] hover:text-[var(--foreground)]"
      />
      {showTabs && (
        <div className="flex-1 flex justify-center">
          <TabSwitcher
            activeTab={activeTab}
            onTabChange={onTabChange}
            className="py-0"
          />
        </div>
      )}
      {showTabs && <div className="size-8 shrink-0" />}
    </AppShell.Header>
  );
}

/** Render chat with sidebar. */
export const ChatWithSidebar = React.forwardRef<
  HTMLDivElement,
  ChatWithSidebarProps
>(
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
      onNewThread,
      onSelectThread,
      onDeleteThread,
      renderHeader,
      toggleIcon,
    },
    ref,
  ): React.ReactElement {
    const nonce = getDocumentNonce();
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
      activeModel: chat.activeModel,
      inferenceMode: chat.inferenceMode,
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
    const [internalTab, setInternalTab] = React.useState<ChatTab>("chat");
    const showTabs = chatProps.showTabs ?? false;

    const isSidebarControlled = controlledOpen !== undefined;

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

        updateThread(
          currentActiveId,
          title ? { messages, title } : { messages },
        );
      }
    }, [messages, updateThread]);

    const setInput = chat.setInput;
    const stopChat = chat.stop;

    const handleSelectThread = React.useCallback(
      (id: string) => {
        // Consumer override runs first; returning `false` skips the internal action.
        if (onSelectThread?.(id) === false) return;
        stopChat?.();
        const currentActiveId = activeIdRef.current;
        if (currentActiveId && messagesRef.current.length > 0) {
          updateThread(currentActiveId, { messages: messagesRef.current });
        }
        selectThread(id);
        const thread = threadsRef.current.find((t) => t.id === id);
        setMessages(thread?.messages ?? []);
        setInput?.("");
      },
      [selectThread, updateThread, setMessages, setInput, stopChat, onSelectThread],
    );

    const handleNewThread = React.useCallback(() => {
      // Consumer override runs first; returning `false` skips the internal action.
      if (onNewThread?.() === false) return;
      stopChat?.();
      const currentActiveId = activeIdRef.current;
      if (currentActiveId && messagesRef.current.length > 0) {
        updateThread(currentActiveId, { messages: messagesRef.current });
      }
      const nextThread = createThread();
      setMessages(nextThread.messages);
      setInput?.("");
    }, [createThread, updateThread, setMessages, setInput, stopChat, onNewThread]);

    const handleDeleteThread = React.useCallback(
      (id: string) => {
        // Consumer override runs first; returning `false` skips the internal action.
        if (onDeleteThread?.(id) === false) return;
        deleteThread(id);
        const next = threadsRef.current.find((t) => t.id !== id);
        setMessages(next?.messages ?? []);
      },
      [deleteThread, setMessages, onDeleteThread],
    );

    const tokenCSS = React.useMemo(() => generateTokenCSS(), []);

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
      <div
        ref={ref}
        className={cn("h-full bg-[var(--background)]", className)}
        data-vf-chat=""
      >
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: tokenCSS }} />
        <AppShell
          className="h-full"
          open={isSidebarControlled ? { left: controlledOpen } : undefined}
          defaultOpen={isSidebarControlled ? undefined : { left: false }}
          onOpenChange={(side) => {
            if (side === "left") onSidebarToggle?.();
          }}
        >
          <AppShell.Sidebar side="left" width={240} aria-label="Conversations">
            <ChatSidebar
              fill
              threads={threads}
              activeThreadId={activeThreadId}
              onSelectThread={handleSelectThread}
              onDeleteThread={handleDeleteThread}
              onRenameThread={renameThread}
              onNewThread={handleNewThread}
            />
          </AppShell.Sidebar>
          <AppShell.Main>
            <ShellHeader
              renderHeader={renderHeader}
              toggleIcon={toggleIcon}
              showTabs={showTabs}
              activeTab={activeTab}
              onTabChange={handleTabChange}
            />
            <AppShell.Content className="flex flex-col">
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
            </AppShell.Content>
          </AppShell.Main>
        </AppShell>
      </div>
    );
  },
);

ChatWithSidebar.displayName = "ChatWithSidebar";
