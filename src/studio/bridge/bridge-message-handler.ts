/**
 * Bridge Message Handler
 *
 * Dispatches incoming Studio messages to the appropriate bridge functions.
 */

import { logger } from "./bridge-logger.ts";
import { state } from "./bridge-state.ts";
import { getConfig } from "./bridge-config.ts";
import { isFromStudio, postToStudio } from "./bridge-messaging.ts";
import {
  hideOverlay,
  scrollToElement,
  setColorMode,
  showHoverOverlay,
  showSelectionOverlay,
} from "./bridge-inspector.ts";
import { captureMultipleSections, captureScreenshot } from "./bridge-screenshot.ts";
import {
  MAX_STUDIO_MESSAGE_ID_LENGTH,
  MAX_STUDIO_SCREENSHOT_REQUEST_ID_LENGTH,
  MAX_STUDIO_SCREENSHOT_SCROLL_OFFSET,
  MAX_STUDIO_SCREENSHOT_SECTIONS,
  MAX_STUDIO_URL_LENGTH,
} from "../limits.ts";

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_MESSAGE_PROPERTIES = 8;
const MAX_SCREENSHOT_OPTION_PROPERTIES = 8;
const MAX_MESSAGE_ACTION_LENGTH = 64;
const MAX_MESSAGE_URL_LENGTH = MAX_STUDIO_URL_LENGTH;
const MAX_NODE_ID_LENGTH = MAX_STUDIO_MESSAGE_ID_LENGTH;
const MAX_SCREENSHOT_SECTIONS = MAX_STUDIO_SCREENSHOT_SECTIONS;
const MAX_SCROLL_OFFSET = MAX_STUDIO_SCREENSHOT_SCROLL_OFFSET;
let screenshotCaptureActive = false;
let screenshotCaptureController: AbortController | null = null;
let studioOperationGeneration = 0;

interface ScreenshotOptions {
  scrollTo?: number;
  fullPage?: boolean;
}

type ParsedScreenshotMessage =
  | {
    action: "screenshot";
    requestId?: string | number;
    multipleSections: true;
    sectionCount?: number;
  }
  | {
    action: "screenshot";
    requestId?: string | number;
    multipleSections?: false;
    options?: Readonly<ScreenshotOptions>;
  };

type ParsedStudioMessage =
  | { action: "routeChange"; url: string }
  | { action: "reload" }
  | { action: "goBack" }
  | { action: "goForward" }
  | { action: "colorMode"; value: "light" | "dark" }
  | { action: "toggleInspectMode"; value: boolean; deselectElements?: boolean }
  | { action: "setSelectedNode"; id: string; scroll?: boolean }
  | { action: "setHoveredNode"; id: string | null }
  | ParsedScreenshotMessage;

/** Run one screenshot operation at a time to bound canvas and scroll-state ownership. */
export async function runExclusiveScreenshotCapture<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<
  | { accepted: true; current: boolean; value: T }
  | { accepted: true; current: boolean; failed: true }
  | { accepted: false }
> {
  if (screenshotCaptureActive) return { accepted: false };
  const generation = studioOperationGeneration;
  const controller = new AbortController();
  screenshotCaptureActive = true;
  screenshotCaptureController = controller;
  try {
    const value = await operation(controller.signal);
    return { accepted: true, current: generation === studioOperationGeneration, value };
  } catch {
    return {
      accepted: true,
      current: generation === studioOperationGeneration,
      failed: true,
    };
  } finally {
    if (screenshotCaptureController === controller) screenshotCaptureController = null;
    screenshotCaptureActive = false;
  }
}

/** Invalidate asynchronous results owned by the current bridge lifecycle. */
export function invalidateStudioMessageOperations(): void {
  studioOperationGeneration++;
  screenshotCaptureController?.abort();
}

function snapshotOwnDataProperties(
  value: unknown,
  maxProperties: number,
): Map<string, unknown> | null {
  if (!value || typeof value !== "object") return null;

  try {
    if (Array.isArray(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > maxProperties || keys.some((key) => typeof key !== "string")) return null;

    const snapshot = new Map<string, unknown>();
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || descriptor.get || descriptor.set) return null;
      snapshot.set(key, descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

function readBoundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength &&
      !value.includes("\0")
    ? value
    : null;
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function readOptionalBoolean(
  snapshot: Map<string, unknown>,
  key: string,
): boolean | undefined | null {
  if (!snapshot.has(key) || snapshot.get(key) === undefined) return undefined;
  const value = snapshot.get(key);
  return typeof value === "boolean" ? value : null;
}

function readOptionalNumber(
  snapshot: Map<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  integer = false,
): number | undefined | null {
  if (!snapshot.has(key) || snapshot.get(key) === undefined) return undefined;
  const value = snapshot.get(key);
  if (
    typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum ||
    (integer && !Number.isInteger(value))
  ) return null;
  return value;
}

function parseScreenshotOptions(value: unknown): Readonly<ScreenshotOptions> | null {
  const options = snapshotOwnDataProperties(value, MAX_SCREENSHOT_OPTION_PROPERTIES);
  if (!options) return null;
  if ([...options.keys()].some((key) => key !== "scrollTo" && key !== "fullPage")) return null;

  const scrollTo = readOptionalNumber(options, "scrollTo", 0, MAX_SCROLL_OFFSET);
  const fullPage = readOptionalBoolean(options, "fullPage");
  if (scrollTo === null || fullPage === null) return null;

  return Object.freeze({
    ...(scrollTo === undefined ? {} : { scrollTo }),
    ...(fullPage === undefined ? {} : { fullPage }),
  });
}

/** Parse and detach a message received across the Studio postMessage boundary. */
export function parseStudioMessage(value: unknown): ParsedStudioMessage | null {
  const message = snapshotOwnDataProperties(value, MAX_MESSAGE_PROPERTIES);
  if (!message) return null;
  const action = readBoundedString(message.get("action"), MAX_MESSAGE_ACTION_LENGTH);
  if (!action) return null;

  switch (action) {
    case "routeChange": {
      const url = readBoundedString(message.get("url"), MAX_MESSAGE_URL_LENGTH);
      return url ? Object.freeze({ action, url }) : null;
    }
    case "reload":
    case "goBack":
    case "goForward":
      return Object.freeze({ action });
    case "colorMode": {
      const mode = message.get("value");
      return mode === "light" || mode === "dark" ? Object.freeze({ action, value: mode }) : null;
    }
    case "toggleInspectMode": {
      const inspect = message.get("value");
      const deselectElements = readOptionalBoolean(message, "deselectElements");
      if (typeof inspect !== "boolean" || deselectElements === null) return null;
      return Object.freeze({
        action,
        value: inspect,
        ...(deselectElements === undefined ? {} : { deselectElements }),
      });
    }
    case "setSelectedNode": {
      const id = readBoundedString(message.get("id"), MAX_NODE_ID_LENGTH);
      const scroll = readOptionalBoolean(message, "scroll");
      if (!id || scroll === null) return null;
      return Object.freeze({ action, id, ...(scroll === undefined ? {} : { scroll }) });
    }
    case "setHoveredNode": {
      const idValue = message.get("id");
      if (idValue === "") return Object.freeze({ action, id: null });
      const id = readBoundedString(idValue, MAX_NODE_ID_LENGTH);
      return id ? Object.freeze({ action, id }) : null;
    }
    case "screenshot": {
      const multipleSections = readOptionalBoolean(message, "multipleSections");
      const sectionCount = readOptionalNumber(
        message,
        "sectionCount",
        1,
        MAX_SCREENSHOT_SECTIONS,
        true,
      );
      if (multipleSections === null || sectionCount === null) return null;

      const requestIdValue = message.get("requestId");
      let requestId: string | number | undefined;
      if (requestIdValue !== undefined) {
        if (typeof requestIdValue === "string") {
          requestId = readBoundedString(
            requestIdValue,
            MAX_STUDIO_SCREENSHOT_REQUEST_ID_LENGTH,
          ) ?? undefined;
          if (requestId === undefined) return null;
        } else if (
          typeof requestIdValue === "number" && Number.isSafeInteger(requestIdValue) &&
          requestIdValue >= 0
        ) {
          requestId = requestIdValue;
        } else {
          return null;
        }
      }

      let options: Readonly<ScreenshotOptions> | undefined;
      if (message.has("options") && message.get("options") !== undefined) {
        options = parseScreenshotOptions(message.get("options")) ?? undefined;
        if (options === undefined) return null;
      }
      if (multipleSections === true) {
        if (options !== undefined) return null;
        return Object.freeze({
          action,
          ...(requestId === undefined ? {} : { requestId }),
          multipleSections: true,
          ...(sectionCount === undefined ? {} : { sectionCount }),
        });
      }
      if (sectionCount !== undefined) return null;

      return Object.freeze({
        action,
        ...(requestId === undefined ? {} : { requestId }),
        ...(multipleSections === undefined ? {} : { multipleSections }),
        ...(options === undefined ? {} : { options }),
      });
    }
    default:
      return null;
  }
}

/** Returns true if the URL is safe for navigation (relative or http/https only). */
export function isSafeNavigationUrl(url: string): boolean {
  return sanitizeNavigationUrl(url) !== null;
}

/**
 * Return a sanitized URL safe for `window.location.href` assignment, or null
 * if the URL must be blocked. Relative paths are normalized against the current
 * origin; absolute URLs
 * must use http/https and target veryfront.com (or a subdomain) to prevent
 * open-redirect. The browser-normalized `parsed.href` is returned instead of
 * the raw input so tainted values never reach the DOM sink.
 */
export function sanitizeNavigationUrl(url: string): string | null {
  if (
    typeof url !== "string" || url.length === 0 || url.length > MAX_MESSAGE_URL_LENGTH ||
    url !== url.trim() || url.startsWith("//") || url.startsWith("\\\\") ||
    hasAsciiControlCharacter(url)
  ) return null;

  try {
    const parsed = new URL(url, globalThis.window.location.origin);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;

    // Allow same-origin navigation unconditionally
    if (parsed.origin === globalThis.window.location.origin) {
      return parsed.href.length <= MAX_MESSAGE_URL_LENGTH ? parsed.href : null;
    }

    // Cross-origin navigation must stay on an authenticated Veryfront HTTPS origin.
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname;
    const isHostedVeryfrontDomain = host === "veryfront.com" || host.endsWith(".veryfront.com") ||
      host === "veryfront.org" || host.endsWith(".veryfront.org");
    if (!isHostedVeryfrontDomain) return null;

    return parsed.href.length <= MAX_MESSAGE_URL_LENGTH ? parsed.href : null;
  } catch {
    return null;
  }
}

function clearSelection(notifyStudio = false): void {
  state.selectedNodeId = null;
  hideOverlay(state.selectionOverlay);

  if (notifyStudio) {
    postToStudio({ action: "setSelectedNode", id: null });
  }
}

function disableInspectMode(deselectElements = false): void {
  state.inspectMode = false;
  hideOverlay(state.hoverOverlay);
  state.hoveredNodeId = null;

  if (deselectElements) {
    clearSelection();
  }
}

function postScreenshotResult(
  requestId: string | number | undefined,
  result: Awaited<ReturnType<typeof captureScreenshot>>,
): void {
  postToStudio({
    action: "screenshotResult",
    requestId,
    multiple: false,
    ...result,
  });
}

function postScreenshotFailure(
  message: ParsedScreenshotMessage,
  error: string,
): void {
  const result = { success: false, error };
  if (message.multipleSections) {
    postToStudio({
      action: "screenshotResult",
      requestId: message.requestId,
      multiple: true,
      results: [result],
    });
    return;
  }
  postScreenshotResult(message.requestId, result);
}

async function handleScreenshotRequest(message: ParsedScreenshotMessage): Promise<void> {
  const execution = await runExclusiveScreenshotCapture(async (signal) => {
    if (message.multipleSections) {
      const results = await captureMultipleSections(message.sectionCount, signal);
      return { multiple: true as const, results };
    }

    const result = await captureScreenshot(message.options, signal);
    return { multiple: false as const, result };
  });
  if (execution.accepted) {
    if (!execution.current) return;
    if ("failed" in execution) {
      logger.error("Screenshot request failed");
      postScreenshotFailure(message, "Screenshot capture failed");
      return;
    }
    if (execution.value.multiple) {
      postToStudio({
        action: "screenshotResult",
        requestId: message.requestId,
        multiple: true,
        results: execution.value.results,
      });
      return;
    }

    postScreenshotResult(message.requestId, execution.value.result);
    return;
  }

  postScreenshotFailure(message, "Screenshot capture is already in progress");
}

export function handleStudioMessage(event: MessageEvent): void {
  if (!isFromStudio(event)) return;

  const message = parseStudioMessage(event.data);
  if (!message) {
    logger.debug("Rejected invalid Studio message");
    return;
  }

  switch (message.action) {
    case "routeChange": {
      const config = getConfig();
      const safeUrl = sanitizeNavigationUrl(message.url);
      if (!safeUrl) {
        logger.warn("[StudioBridge] Blocked unsafe URL in routeChange");
        return;
      }
      if (state.selectedNodeId) {
        clearSelection(true);
      }
      postToStudio({
        action: "onPageTransitionStart",
        url: safeUrl,
        projectId: config.projectId,
      });
      globalThis.window.location.href = safeUrl;
      return;
    }

    case "reload":
      globalThis.window.location.reload();
      return;

    case "goBack":
      globalThis.window.history.back();
      return;

    case "goForward":
      globalThis.window.history.forward();
      return;

    case "colorMode":
      setColorMode(message.value);
      return;

    case "toggleInspectMode":
      state.inspectMode = message.value;
      if (state.inspectMode) return;

      disableInspectMode(message.deselectElements);
      return;

    case "setSelectedNode":
      state.selectedNodeId = message.id;
      showSelectionOverlay(message.id);
      if (message.scroll) scrollToElement(message.id);
      return;

    case "setHoveredNode":
      if (state.inspectMode) return;
      state.hoveredNodeId = message.id;
      showHoverOverlay(message.id);
      return;

    case "screenshot":
      void handleScreenshotRequest(message);
      return;
  }
}
