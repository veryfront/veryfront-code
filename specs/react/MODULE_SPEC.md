# NLSpec: src/react/

## Purpose

The `src/react/` module provides the complete React integration layer for the Veryfront platform. It contains three major subsystems: (1) a React version compatibility layer (`compat/`) that detects React 17/18/19 features, adapts hooks, and provides version-aware SSR rendering; (2) a component library spanning page-level concerns (Head, routing, page context, MDX, fonts, optimized images, layout/provider wrappers) and a full-featured AI chat UI system with preset, composition, and compound component patterns; and (3) a set of headless UI primitives for chat, messages, agents, and tools that the AI components build upon. Two barrel files serve as entry points: `index.ts` (internal rendering pipeline) and `public.ts` (browser-side consumer API via `veryfront/react`).

## Public API

### Exports — `index.ts` (internal/SSR entry point)

| Export | Type | Description |
|--------|------|-------------|
| `getProjectReact` | function | Load project-specific React from cached HTTP modules |
| `getReactVersionInfo` | function | Get cached React version info for bundled React |
| `getReactVersionInfoForProject` | function | Get React version info for a specific project dir |
| `ReactVersionInfo` | type | Version info with major/minor/patch and feature flags |
| `renderToStreamAdapter` | function | Version-aware SSR stream rendering with timeout/fallback |
| `renderToStringAdapter` | function | Version-aware SSR string rendering |
| `SSROptions` / `SSRResult` | types | SSR configuration and result types |
| `AppWrapper` / `AppWrapperProps` | component | Wraps page content with providers and layout |
| `Head` | component | Declarative `<head>` metadata (SSR + client) |
| `MDXProvider` / `useMDXComponents` | component/hook | MDX component context |
| `OptimizedImage` / `SimpleOptimizedImage` / `OptimizedBackgroundImage` | components | Image optimization with srcset/blur |
| `useOptimizedImage` | hook | Image optimization hook |
| `generateBlurDataURL` / `getAspectRatioPadding` / `ResponsiveImageContainer` | utilities | Image helpers |
| `ChatContainer` / `MessageList` / `MessageItem` / `MessageRole` / `MessageContent` | primitives | Headless chat UI building blocks |
| `InputBox` / `SubmitButton` / `LoadingIndicator` | primitives | Input/submit primitives |
| `AgentContainer` / `AgentStatus` / `ThinkingIndicator` | primitives | Agent UI primitives |
| `ToolInvocation` / `ToolResult` / `ToolList` | primitives | Tool display primitives |
| `collectHead` / `runWithHeadCollector` / `flushHeadCollector` / `resetHeadCollector` / `getHeadCollectorContext` / `hasCollectedHead` | functions | SSR head metadata collection via AsyncLocalStorage |
| `PageContextProvider` / `usePageContext` | component/hook | Page context (params, query, frontmatter, headings) |
| `Router` / `RouterProvider` / `useRouter` | component/hook | Client-side routing context |
| `GoogleFonts` | component | Google Fonts loader with CSS variable injection |

### Exports — `public.ts` (browser-side consumer API)

| Export | Type | Description |
|--------|------|-------------|
| `Chat` / `ChatComponents` | components | Preset chat UI and compound component API |
| `ChatRoot` / `ChatMessageList` / `ChatComposer` / `ChatEmpty` / `ChatIf` / `Message` / `ErrorBanner` / `ModelAvatar` | composition | Building blocks for custom chat layouts |
| `ChatContextProvider` / `useChatContext` / `MessageContextProvider` / `useMessageContext` / `ComposerContextProvider` / `useComposerContext` / `ThreadListContextProvider` / `useThreadListContext` | contexts | Chat component tree state management |
| `AttachmentPill` / `BranchPicker` / `ChatSidebar` / `ChatWithSidebar` / `ConversationEmptyState` / `DropZoneOverlay` / `InferenceBadge` / `MessageActions` / `MessageEditForm` / `MessageFeedback` / `ModelSelector` / `QuickActions` / `ReasoningCard` / `RichCodeBlock` / `Sources` / `TabSwitcher` / `ToolCallCard` / `UpgradeCTA` / `UploadsPanel` | sub-components | Chat sub-components |
| `useChat` / `useAgent` / `useCompletion` / `useStreaming` / `useVoiceInput` | hooks | AI interaction hooks (re-exported from agent module) |
| `useUploads` | hook | File upload hook (re-exported from embedding module) |
| `StandaloneMessage` / `StreamingMessage` | components | Standalone message display |
| `AgentCard` | component | Agent status/tool display card |
| `AIErrorBoundary` / `useAIErrorHandler` | component/hook | Error boundary for AI components |
| `Markdown` | component | Markdown renderer with mermaid/GFM/syntax highlighting |
| `cn` / `cva` / `mergeThemes` / `messageVariants` / `chatButtonVariants` / `chatContainerVariants` | utilities | Theme/styling utilities |
| `ColorModeProvider` / `ColorModeScript` / `ColorModeToggle` / `useColorMode` | component/hook | Dark/light mode system |
| `chatTokens` / `getChatTokensCSS` / `ChatStyleProvider` | utilities | Design token system |
| `Head` / `Link` / `RouterProvider` / `useRouter` / `PageContextProvider` / `usePageContext` / `GoogleFonts` / `MDXProvider` / `useMDXComponents` | component/hook | Core page components (mirrored from index.ts) |
| `exportAsMarkdown` / `downloadMarkdown` / `groupPartsInOrder` / `getTextContent` / `extractSourcesFromParts` / `isToolPart` / `isReasoningPart` / `useThreads` | utilities/hooks | Chat utility functions |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `react`, `react-dom/server` | esm.sh / import map | Core React library |
| `clsx` | esm.sh | Class name composition |
| `tailwind-merge` | esm.sh | Tailwind CSS class deduplication |
| `class-variance-authority` | esm.sh | Component variant definitions |
| `node:async_hooks` | Deno stdlib | AsyncLocalStorage for SSR head collection |
| `#veryfront/agent/react` | internal | AI hooks (useChat, useAgent, etc.) and UI message types |
| `#veryfront/agent` | internal | Agent types (AgentStatus, ToolCall, Message) |
| `#veryfront/embedding/react` | internal | Upload hooks |
| `#veryfront/types` | internal | MDXComponents, MdxBundle, PageContext |
| `#veryfront/transforms/mdx` | internal | MDX rendering |
| `#veryfront/transforms/esm` | internal | React URL resolution, HTTP module caching |
| `#veryfront/platform/compat` | internal | Runtime detection, filesystem abstraction |
| `#veryfront/observability/tracing` | internal | SSR tracing spans |
| `#veryfront/config` | internal | Debug env, SSR timeout defaults |
| `#veryfront/errors` | internal | Typed error creation |
| `#veryfront/security/client` | internal | HTML sanitization for mermaid SVG |
| `#veryfront/utils` | internal | Logger, path utils, singleflight, cache dir |

## Behaviors

### Behavior 1: SSR Head Collection
- **Given**: A React tree is rendered on the server inside `runWithHeadCollector()`
- **When**: Components use `<Head>` with `<title>`, `<meta>`, `<link>`, `<style>`, or `<script>` children
- **Then**: Head metadata is collected into the `CollectedHead` result, isolated per request via AsyncLocalStorage
- **Edge cases**: Multiple `<title>` elements: last one wins. `<meta name="description">` also sets `description`. Scripts deduplicated by id or src. Calls outside a collector context are silently ignored.

### Behavior 2: Client-side Head Management
- **Given**: A `<Head>` component mounts in the browser
- **When**: The component renders with child elements
- **Then**: DOM elements are appended to `document.head` with `data-veryfront-managed="1"` and cleaned up on unmount
- **Edge cases**: SSR'd scripts with `data-vf-head` are not re-executed. Inline scripts without id are deduplicated by content hash.

### Behavior 3: React Version Detection and Feature Flags
- **Given**: The React module is loaded
- **When**: `getReactVersionInfo()` is called
- **Then**: Returns cached `ReactVersionInfo` with `isReact17/18/19` flags and feature flags for SSR methods, hooks, Suspense, etc.
- **Edge cases**: React 18 RC versions with "rc" in the version string are detected as React 19. Version info is cached globally (singleton).

### Behavior 4: Version-Aware SSR Rendering
- **Given**: An SSR render is requested via `renderToStreamAdapter()`
- **When**: React 18+ is detected with `renderToReadableStream` available
- **Then**: Uses streaming SSR with abort timeout, falling back to `renderToString` on error
- **Edge cases**: Timeout aborts the render after `SSR_TIMEOUT_MS`. If streaming fails, falls back to string rendering. If string rendering also fails, the error propagates.

### Behavior 5: Compat Hooks Adaptation
- **Given**: User code calls `useTransitionCompat()`, `useIdCompat()`, etc.
- **When**: Running on React 17 (hooks not natively available)
- **Then**: Polyfilled implementations are used (useState-based useId with counter, setTimeout-based useTransition, identity useDeferredValue)
- **Edge cases**: On React 18/19, native hooks are used. If native hook throws, falls back to polyfill with a warning.

### Behavior 6: Chat Preset Component
- **Given**: A `<Chat>` component is rendered with messages, input, and handlers
- **When**: The component mounts
- **Then**: Composes ChatRoot, ChatMessageList/ChatEmpty, ChatComposer, ErrorBanner, DropZoneOverlay, TabSwitcher, InferenceBadge, QuickActions, and UpgradeCTA based on props
- **Edge cases**: Empty messages shows ChatEmpty with suggestions. Tab switching between "chat" and "uploads". Drag-and-drop file handling. Voice input integration.

### Behavior 7: Chat Composition API
- **Given**: User builds a custom chat layout using ChatRoot, ChatMessageList, ChatComposer, etc.
- **When**: Components are composed in a custom tree
- **Then**: ChatContext, ComposerContext, MessageContext, and ThreadListContext provide state to descendants
- **Edge cases**: Optional contexts (e.g. `useChatContextOptional()`) return null when used outside a provider.

### Behavior 8: Color Mode System
- **Given**: A `<ColorModeProvider>` wraps the app
- **When**: User calls `useColorMode().toggleMode()` or system preference changes
- **Then**: Mode is persisted to localStorage, applied as class/data-attribute on `<html>`, and `ColorModeScript` prevents flash on SSR
- **Edge cases**: Storage unavailable (private browsing). System mode tracks `prefers-color-scheme` changes.

### Behavior 9: Page Context and Router
- **Given**: A page is rendered with `PageContextProvider` and `RouterProvider`
- **When**: Components call `usePageContext()` or `useRouter()`
- **Then**: Returns page metadata (slug, params, query, frontmatter, headings) or router state (path, navigate, push, replace)
- **Edge cases**: Default values used when no provider is present. `mdxHeadings` is a deprecated alias for `headings`.

### Behavior 10: Optimized Image Components
- **Given**: An `<OptimizedImage>` is rendered with a src path
- **When**: The component renders
- **Then**: Generates optimized image paths with srcset for multiple sizes and formats (webp, avif)
- **Edge cases**: Falls back to original src if optimization not available. Blur placeholder data URLs for progressive loading.

### Behavior 11: Markdown Rendering
- **Given**: A `<Markdown>` component receives markdown text
- **When**: The component mounts in the browser
- **Then**: Dynamically imports react-markdown, remark-gfm, rehype-highlight from esm.sh; renders with GFM, syntax highlighting, and optional mermaid diagram support
- **Edge cases**: Server-side falls back to plain text in `<p>` tags. Mermaid rendering is client-only. SVG output is sanitized.

## Constraints
- Must support React 17, 18, and 19 simultaneously via compat layer
- SSR must isolate head collection per concurrent request (AsyncLocalStorage)
- Uses Deno runtime: `globalThis` instead of `window`, esm.sh imports, deno lint compliance
- `no-explicit-any` lint directives are used only where necessary (dynamic ESM imports in markdown.tsx, ref type coercion in input-box.tsx)
- All test files use Deno test framework (`#veryfront/testing`)

## Error Handling
- SSR rendering: timeout → abort → fallback to string rendering → throw
- Head collection: silently ignores calls outside collector context
- MDX rendering: catches errors, logs, returns fallback (children passthrough)
- AI components: `AIErrorBoundary` catches render errors with retry UI
- `useAIErrorHandler` hook provides imperative error state management
- Compat hooks: try/catch around native hook calls, fall back to polyfill with warning

## Side Effects
- `Head` component: modifies `document.head` and `document.title` on mount, cleans up on unmount
- `ColorModeProvider`: modifies `document.documentElement` classes/attributes, reads/writes localStorage
- `Markdown`: dynamically imports ESM modules from esm.sh on first render
- `ModelSelector`: adds/removes global event listeners for keyboard navigation and outside click
- SSR adapters: cache React and ReactDOM server modules in module-level variables
- Version detector: caches version info in module-level variables

## Performance Constraints
- React version info is cached (singleton) to avoid repeated detection
- Project version cache uses a Map keyed by project directory
- SSR rendering has a configurable timeout (`SSR_TIMEOUT_MS`)
- React/ReactDOM server loading uses Singleflight to prevent duplicate concurrent loads
- Markdown dependencies are lazily loaded once on first render
- `useStableObject` in LayoutComponent prevents re-renders via JSON serialization comparison
- Chat theme merging is memoized via `React.useMemo`

## Invariants
- `runWithHeadCollector` always returns both `result` and `head`, even if no head metadata was collected
- `flushHeadCollector` returns a snapshot and clears the store atomically
- React version detection: exactly one of `isReact17`, `isReact18`, `isReact19` is true (with caveat: React 18 RC has both `isReact18` and `isReact19` true)
- All primitives forward refs and spread remaining props to their root DOM element
- Chat contexts provide both required (`useChatContext`) and optional (`useChatContextOptional`) accessors
- The `Chat` preset component is a pure composition of the building blocks — no additional logic beyond wiring
