/**
 * Entry point of the client hydration runtime.
 *
 * esbuild bundles this file into the single artifact the browser loads —
 * `/_veryfront/hydration-runtime.<hash>.js` in production, the inline module
 * script in dev. React and the veryfront react runtime stay external so the
 * document's import map resolves them, exactly as before this runtime became
 * real modules.
 *
 * This file is the only place that touches browser globals directly; everything
 * else takes them as arguments so it can be driven by stubs under `deno test`.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, useRouter as useRouterFromModule } from "veryfront/router";
import * as RouterRuntime from "veryfront/router";
import { PageContextProvider } from "veryfront/context";

import type {
  HydrationRuntimeEnv,
  ModuleNamespace,
  ReactLike,
  RuntimeDocument,
  RuntimeFetchInit,
  RuntimeWindow,
} from "./env.ts";
import { createLogging, moduleServerUrl } from "./shared.ts";
import {
  readDocumentDependencyPinningCacheKey,
  readInitialHydrationData,
} from "./hydration-data.ts";
import { createSnapshotModuleImporter } from "./snapshot-modules.ts";
import { createComponentLoader } from "./component-loader.ts";
import { createRouteTimingRecorder } from "./route-timing.ts";
import { createRouterRuntime } from "./router.ts";
import { createHydrationRenderer } from "./renderer.ts";
import { resolveNavigationStore } from "./navigation-store.ts";

const runtimeWindow: RuntimeWindow = globalThis as typeof globalThis & RuntimeWindow;
const runtimeDocument: RuntimeDocument =
  (globalThis as typeof globalThis & { document: RuntimeDocument }).document;

const env: HydrationRuntimeEnv = {
  window: runtimeWindow,
  document: runtimeDocument,
  fetch: (url: string, init?: RuntimeFetchInit) => fetch(url, init as RequestInit),
  React: React as typeof React & ReactLike,
  RouterProvider,
  PageContextProvider,
  createRoot: (container: unknown) => createRoot(container as HTMLElement),
  importModule: (moduleUrl: string) => import(moduleUrl) as Promise<ModuleNamespace>,
  useRouterFromModule,
  setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
  clearTimeout: (id: number) => clearTimeout(id),
};

const logging = createLogging(runtimeWindow);
const initialHydrationData = readInitialHydrationData(runtimeDocument);
const documentDependencyPinningCacheKey = readDocumentDependencyPinningCacheKey(
  initialHydrationData,
);
const routeTiming = createRouteTimingRecorder(runtimeWindow, logging);

const snapshotModules = createSnapshotModuleImporter({
  importModule: env.importModule,
  fetchModule: env.fetch,
  reloadDocument: () => runtimeWindow.location.reload(),
  recoveryState: runtimeWindow as RuntimeWindow & Record<string, unknown>,
});

const componentLoader = createComponentLoader({
  window: runtimeWindow,
  logging,
  moduleServerUrl: moduleServerUrl(runtimeWindow),
  snapshotModules,
});

// The module loader's switches stay on `window`: HMR, the Studio embed and the
// release pipeline all reach for them by name.
runtimeWindow.__veryfrontClearComponentCache = componentLoader.clearComponentCache;
runtimeWindow.__veryfrontSetStudioEmbed = componentLoader.setStudioEmbed;
runtimeWindow.__veryfrontSetReleaseId = componentLoader.setReleaseId;
runtimeWindow.__veryfrontSetReleaseAssetModules = componentLoader.setReleaseAssetModules;
runtimeWindow.__veryfrontSetHMRRefreshTimestamp = componentLoader.setHMRRefreshTimestamp;

const { usesRegistryFallback, getNavigationStore } = resolveNavigationStore(RouterRuntime);

const routerRuntime = createRouterRuntime({
  env,
  logging,
  routeTiming,
  componentLoader,
  snapshotModules,
  initialHydrationData,
  documentDependencyPinningCacheKey,
  getNavigationStore,
  navigationStoreUsesRegistryFallback: usesRegistryFallback,
});

createHydrationRenderer({
  env,
  logging,
  componentLoader,
  snapshotModules,
  moduleServerUrl: moduleServerUrl(runtimeWindow),
  router: routerRuntime.router,
}).start();
