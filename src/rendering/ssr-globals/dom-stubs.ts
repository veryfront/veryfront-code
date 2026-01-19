/**
 * SSR DOM Stubs
 *
 * Provides minimal browser API stubs for SSR to prevent crashes when
 * third-party libraries check for browser features during server rendering.
 *
 * These are NOT full implementations - just enough to not throw errors.
 * Components should still use proper guards (typeof window !== 'undefined')
 * for any actual browser functionality.
 *
 * @module rendering/ssr-globals/dom-stubs
 */

/**
 * Minimal element stub
 */
export const createElementStub = () => ({
  style: {},
  classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => false },
  dataset: {},
  setAttribute: () => {},
  getAttribute: () => null,
  removeAttribute: () => {},
  hasAttribute: () => false,
  appendChild: () => {},
  removeChild: () => {},
  insertBefore: () => {},
  replaceChild: () => {},
  cloneNode: () => createElementStub(),
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  offsetWidth: 0,
  offsetHeight: 0,
  scrollWidth: 0,
  scrollHeight: 0,
  clientWidth: 0,
  clientHeight: 0,
  innerHTML: "",
  outerHTML: "",
  textContent: "",
  innerText: "",
  children: [],
  childNodes: [],
  parentNode: null,
  parentElement: null,
  nextSibling: null,
  previousSibling: null,
  firstChild: null,
  lastChild: null,
});

/**
 * Minimal document stub for SSR
 * Handles common feature detection patterns like:
 * - 'exitFullscreen' in document
 * - document.createElement
 * - document.querySelector
 */
export const createDocumentStub = () => ({
  __veryfrontSSRStub: true,
  // Fullscreen API (video.js, etc.)
  exitFullscreen: undefined,
  webkitExitFullscreen: undefined,
  mozCancelFullScreen: undefined,
  msExitFullscreen: undefined,
  fullscreenElement: null,
  webkitFullscreenElement: null,
  mozFullScreenElement: null,
  msFullscreenElement: null,

  // DOM methods (return null/empty to indicate not found)
  createElement: () => createElementStub(),
  createElementNS: () => createElementStub(),
  createTextNode: () => ({ textContent: "" }),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  getElementsByClassName: () => [],
  getElementsByTagName: () => [],
  getElementsByName: () => [],

  // Document properties
  documentElement: {
    style: {},
    classList: { add: () => {}, remove: () => {}, contains: () => false },
  },
  body: {
    style: {},
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    appendChild: () => {},
  },
  head: { appendChild: () => {}, removeChild: () => {} },
  readyState: "complete",
  cookie: "",
  domain: "",
  referrer: "",
  title: "",
  URL: "",
  location: { href: "", pathname: "/", search: "", hash: "" },

  // Event handling (no-op)
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,

  // Style/CSS
  styleSheets: [],
  adoptedStyleSheets: [],
});

/**
 * Minimal window stub for SSR
 */
export const createWindowStub = () => ({
  __veryfrontSSRStub: true,
  // Common properties
  document: createDocumentStub(),
  navigator: {
    userAgent: "SSR",
    language: "en-US",
    languages: ["en-US"],
    platform: "SSR",
    vendor: "",
    onLine: true,
    cookieEnabled: false,
    mediaDevices: { getUserMedia: () => Promise.reject(new Error("SSR")) },
  },
  location: {
    href: "",
    pathname: "/",
    search: "",
    hash: "",
    origin: "",
    protocol: "https:",
    host: "",
    hostname: "",
    port: "",
    assign: () => {},
    replace: () => {},
    reload: () => {},
  },
  history: {
    length: 0,
    state: null,
    pushState: () => {},
    replaceState: () => {},
    go: () => {},
    back: () => {},
    forward: () => {},
  },

  // Dimensions (common for responsive checks)
  innerWidth: 1024,
  innerHeight: 768,
  outerWidth: 1024,
  outerHeight: 768,
  screenX: 0,
  screenY: 0,
  pageXOffset: 0,
  pageYOffset: 0,
  scrollX: 0,
  scrollY: 0,
  devicePixelRatio: 1,

  // Timers (use real implementations if available)
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  requestAnimationFrame: (cb: () => void) => globalThis.setTimeout(cb, 16),
  cancelAnimationFrame: globalThis.clearTimeout,

  // Storage (no-op)
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    length: 0,
    key: () => null,
  },
  sessionStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    length: 0,
    key: () => null,
  },

  // Events
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,

  // Media queries
  matchMedia: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }),

  // Misc
  getComputedStyle: () => ({
    getPropertyValue: () => "",
  }),
  getSelection: () => null,
  print: () => {},
  alert: () => {},
  confirm: () => false,
  prompt: () => null,
  open: () => null,
  close: () => {},
  focus: () => {},
  blur: () => {},
  scroll: () => {},
  scrollTo: () => {},
  scrollBy: () => {},
  resizeTo: () => {},
  resizeBy: () => {},
  moveTo: () => {},
  moveBy: () => {},

  // Crypto (basic stub)
  crypto: globalThis.crypto,

  // Performance
  performance: globalThis.performance,

  // fetch is available in Deno
  fetch: globalThis.fetch,

  // URL/URLSearchParams are available in Deno
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,

  // TextEncoder/Decoder are available in Deno
  TextEncoder: globalThis.TextEncoder,
  TextDecoder: globalThis.TextDecoder,
});

/**
 * Create a stub class for DOM element types.
 * Used by libraries like framer-motion that check instanceof.
 */
// deno-lint-ignore no-explicit-any
export function createElementClass(name: string): any {
  // Create a named class for better debugging
  const ElementClass = class {};
  Object.defineProperty(ElementClass, "name", { value: name });
  return ElementClass;
}
