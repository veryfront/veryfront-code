// SSR adapters (used by internal rendering pipeline + advanced users)
export {
  getProjectReact,
  getReactVersionInfo,
  getReactVersionInfoForProject,
  type ReactVersionInfo,
  renderToStreamAdapter,
  renderToStringAdapter,
  type SSROptions,
  type SSRResult,
} from "./compat/index.ts";

// Components
export { AppWrapper, type AppWrapperProps } from "./components/AppWrapper.tsx";
export { Head } from "./components/Head.tsx";
export { MDXProvider, type MDXProviderProps, useMDXComponents } from "./components/MDXProvider.tsx";
export {
  generateBlurDataURL,
  getAspectRatioPadding,
  OptimizedBackgroundImage,
  OptimizedImage,
  type OptimizedImageProps,
  ResponsiveImageContainer,
  SimpleOptimizedImage,
  useOptimizedImage,
} from "./components/optimized-image/index.ts";

// Primitives (user-facing chat/agent UI)
export { ChatContainer, type ChatContainerProps } from "./primitives/chat-container.tsx";
export {
  MessageContent,
  type MessageContentProps,
  MessageItem,
  type MessageItemProps,
  MessageList,
  type MessageListProps,
  MessageRole,
  type MessageRoleProps,
} from "./primitives/message-list.tsx";
export {
  InputBox,
  type InputBoxProps,
  LoadingIndicator,
  type LoadingIndicatorProps,
  SubmitButton,
  type SubmitButtonProps,
} from "./primitives/input-box.tsx";
export {
  AgentContainer,
  type AgentContainerProps,
  AgentStatus,
  type AgentStatusProps,
  ThinkingIndicator,
  type ThinkingIndicatorProps,
} from "./primitives/agent-primitives.tsx";
export {
  ToolInvocation,
  type ToolInvocationProps,
  ToolList,
  type ToolListProps,
  ToolResult,
  type ToolResultProps,
} from "./primitives/tool-primitives.tsx";

// Head collector
export {
  type CollectedHead,
  collectHead,
  flushHeadCollector,
  getHeadCollectorContext,
  hasCollectedHead,
  type HeadLink,
  type HeadMeta,
  resetHeadCollector,
  runWithHeadCollector,
} from "./head-collector.ts";

export {
  type MdxHeading,
  PageContextProvider,
  type PageContextValue,
  usePageContext,
} from "./context/index.tsx";

export {
  Router,
  RouterProvider,
  type RouterProviderProps,
  type RouterValue,
  useRouter,
} from "./router/index.tsx";

export { GoogleFonts } from "./fonts/index.ts";
