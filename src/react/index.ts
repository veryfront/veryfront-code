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

// Components — selective (internal LayoutComponent/ProviderComponent removed)
export * from "./components/index.ts";

// Primitives — keep wildcard (all user-facing chat/agent UI)
export * from "./primitives/index.ts";

// Head collector
export * from "./head-collector.ts";

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
