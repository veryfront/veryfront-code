export {
  createReactVersionSwitcher,
  detectReactVersionFromConfig,
  generateAllReactConfigs,
  generateReactVersionConfig,
  getReactImports,
  REACT_CONFIGS,
  type ReactVersion,
  type ReactVersionConfig,
} from "./config-generator.ts";
export {
  type CompatHooks,
  compatHooks,
  CompatHooksProvider,
  type FormStatus,
  type OptimisticStateAction,
  SuspenseCompat,
  useCompatHooks,
  useDeferredValueCompat,
  useFormStatusCompat,
  useIdCompat,
  useOptimisticCompat,
  useTransitionCompat,
} from "./hooks-adapter.ts";
export {
  createSSRResponse,
  getProjectReact,
  renderToStaticMarkupAdapter,
  renderToStreamAdapter,
  renderToStringAdapter,
  type SSROptions,
  type SSRResult,
} from "./ssr-adapter/index.ts";
export {
  checkVersionCompatibility,
  detectReactVersion,
  getReactVersionInfo,
  getRecommendedSSRMethod,
  hasFeature,
  type ReactFeatures,
  type ReactVersionInfo,
} from "./version-detector/index.ts";
