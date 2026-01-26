export { createReactVersionSwitcher, detectReactVersionFromConfig, generateAllReactConfigs, generateReactVersionConfig, getReactImports, REACT_CONFIGS, } from "./config-generator.js";
export { compatHooks, CompatHooksProvider, SuspenseCompat, useCompatHooks, useDeferredValueCompat, useFormStatusCompat, useIdCompat, useOptimisticCompat, useTransitionCompat, } from "./hooks-adapter.js";
export { createSSRResponse, getProjectReact, renderToStaticMarkupAdapter, renderToStreamAdapter, renderToStringAdapter, } from "./ssr-adapter/index.js";
export { checkVersionCompatibility, clearProjectVersionCache, detectReactVersion, getReactVersionInfo, getReactVersionInfoForProject, getRecommendedSSRMethod, hasFeature, } from "./version-detector/index.js";
