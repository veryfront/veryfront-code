const noop = (): void => {};
const noopTrue = (): true => true;
const noopFalse = (): false => false;
const noopNull = (): null => null;
const noopEmptyArray = (): [] => [];
const emptyString = "";

/** Default SSR viewport width for window stub */
const SSR_VIEWPORT_WIDTH = 1_024;
/** Default SSR viewport height for window stub */
const SSR_VIEWPORT_HEIGHT = 768;

function createClassListStub(): {
  add: () => void;
  remove: () => void;
  contains: () => false;
  toggle: () => false;
} {
  return {
    add: noop,
    remove: noop,
    contains: noopFalse,
    toggle: noopFalse,
  };
}

export function createElementStub(): {
  style: Record<string, unknown>;
  classList: ReturnType<typeof createClassListStub>;
  dataset: Record<string, unknown>;
  setAttribute: () => void;
  getAttribute: () => null;
  removeAttribute: () => void;
  hasAttribute: () => false;
  appendChild: () => void;
  removeChild: () => void;
  insertBefore: () => void;
  replaceChild: () => void;
  cloneNode: () => ReturnType<typeof createElementStub>;
  addEventListener: () => void;
  removeEventListener: () => void;
  querySelector: () => null;
  querySelectorAll: () => [];
  getBoundingClientRect: () => {
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  offsetWidth: number;
  offsetHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  innerHTML: string;
  outerHTML: string;
  textContent: string;
  innerText: string;
  children: [];
  childNodes: [];
  parentNode: null;
  parentElement: null;
  nextSibling: null;
  previousSibling: null;
  firstChild: null;
  lastChild: null;
} {
  return {
    style: {},
    classList: createClassListStub(),
    dataset: {},
    setAttribute: noop,
    getAttribute: noopNull,
    removeAttribute: noop,
    hasAttribute: noopFalse,
    appendChild: noop,
    removeChild: noop,
    insertBefore: noop,
    replaceChild: noop,
    cloneNode: createElementStub,
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: noopNull,
    querySelectorAll: noopEmptyArray,
    getBoundingClientRect: () => ({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    }),
    offsetWidth: 0,
    offsetHeight: 0,
    scrollWidth: 0,
    scrollHeight: 0,
    clientWidth: 0,
    clientHeight: 0,
    innerHTML: emptyString,
    outerHTML: emptyString,
    textContent: emptyString,
    innerText: emptyString,
    children: [],
    childNodes: [],
    parentNode: null,
    parentElement: null,
    nextSibling: null,
    previousSibling: null,
    firstChild: null,
    lastChild: null,
  };
}

export function createDocumentStub(): {
  __veryfrontSSRStub: true;
  exitFullscreen: undefined;
  webkitExitFullscreen: undefined;
  mozCancelFullScreen: undefined;
  msExitFullscreen: undefined;
  fullscreenElement: null;
  webkitFullscreenElement: null;
  mozFullScreenElement: null;
  msFullscreenElement: null;
  createElement: () => ReturnType<typeof createElementStub>;
  createElementNS: () => ReturnType<typeof createElementStub>;
  createTextNode: () => { textContent: string };
  querySelector: () => null;
  querySelectorAll: () => [];
  getElementById: () => null;
  getElementsByClassName: () => [];
  getElementsByTagName: () => [];
  getElementsByName: () => [];
  documentElement: {
    style: Record<string, unknown>;
    classList: Omit<ReturnType<typeof createClassListStub>, "toggle">;
  };
  body: {
    style: Record<string, unknown>;
    classList: Omit<ReturnType<typeof createClassListStub>, "toggle">;
    appendChild: () => void;
  };
  head: { appendChild: () => void; removeChild: () => void };
  readyState: "complete";
  cookie: string;
  domain: string;
  referrer: string;
  title: string;
  URL: string;
  location: { href: string; pathname: string; search: string; hash: string };
  addEventListener: () => void;
  removeEventListener: () => void;
  dispatchEvent: () => true;
  styleSheets: [];
  adoptedStyleSheets: [];
} {
  const classList = {
    add: noop,
    remove: noop,
    contains: noopFalse,
  };

  return {
    __veryfrontSSRStub: true,
    exitFullscreen: undefined,
    webkitExitFullscreen: undefined,
    mozCancelFullScreen: undefined,
    msExitFullscreen: undefined,
    fullscreenElement: null,
    webkitFullscreenElement: null,
    mozFullScreenElement: null,
    msFullscreenElement: null,

    createElement: createElementStub,
    createElementNS: createElementStub,
    createTextNode: () => ({ textContent: emptyString }),
    querySelector: noopNull,
    querySelectorAll: noopEmptyArray,
    getElementById: noopNull,
    getElementsByClassName: noopEmptyArray,
    getElementsByTagName: noopEmptyArray,
    getElementsByName: noopEmptyArray,

    documentElement: { style: {}, classList },
    body: { style: {}, classList, appendChild: noop },
    head: { appendChild: noop, removeChild: noop },
    readyState: "complete",
    cookie: emptyString,
    domain: emptyString,
    referrer: emptyString,
    title: emptyString,
    URL: emptyString,
    location: { href: emptyString, pathname: "/", search: emptyString, hash: emptyString },

    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noopTrue,

    styleSheets: [],
    adoptedStyleSheets: [],
  };
}

export function createWindowStub(): {
  __veryfrontSSRStub: true;
  document: ReturnType<typeof createDocumentStub>;
  navigator: {
    userAgent: string;
    language: string;
    languages: string[];
    platform: string;
    vendor: string;
    onLine: true;
    cookieEnabled: false;
    mediaDevices: { getUserMedia: () => Promise<never> };
  };
  location: {
    href: string;
    pathname: string;
    search: string;
    hash: string;
    origin: string;
    protocol: string;
    host: string;
    hostname: string;
    port: string;
    assign: () => void;
    replace: () => void;
    reload: () => void;
  };
  history: {
    length: number;
    state: null;
    pushState: () => void;
    replaceState: () => void;
    go: () => void;
    back: () => void;
    forward: () => void;
  };
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  screenX: number;
  screenY: number;
  pageXOffset: number;
  pageYOffset: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
  requestAnimationFrame: (cb: () => void) => ReturnType<typeof globalThis.setTimeout>;
  cancelAnimationFrame: typeof globalThis.clearTimeout;
  localStorage: {
    getItem: () => null;
    setItem: () => void;
    removeItem: () => void;
    clear: () => void;
    length: number;
    key: () => null;
  };
  sessionStorage: {
    getItem: () => null;
    setItem: () => void;
    removeItem: () => void;
    clear: () => void;
    length: number;
    key: () => null;
  };
  addEventListener: () => void;
  removeEventListener: () => void;
  dispatchEvent: () => true;
  matchMedia: (query: string) => {
    matches: false;
    media: string;
    onchange: null;
    addListener: () => void;
    removeListener: () => void;
    addEventListener: () => void;
    removeEventListener: () => void;
    dispatchEvent: () => true;
  };
  getComputedStyle: () => { getPropertyValue: () => string };
  getSelection: () => null;
  print: () => void;
  alert: () => void;
  confirm: () => false;
  prompt: () => null;
  open: () => null;
  close: () => void;
  focus: () => void;
  blur: () => void;
  scroll: () => void;
  scrollTo: () => void;
  scrollBy: () => void;
  resizeTo: () => void;
  resizeBy: () => void;
  moveTo: () => void;
  moveBy: () => void;
  crypto: typeof globalThis.crypto;
  performance: typeof globalThis.performance;
  fetch: typeof globalThis.fetch;
  URL: typeof globalThis.URL;
  URLSearchParams: typeof globalThis.URLSearchParams;
  TextEncoder: typeof globalThis.TextEncoder;
  TextDecoder: typeof globalThis.TextDecoder;
} {
  return {
    __veryfrontSSRStub: true,
    document: createDocumentStub(),
    navigator: {
      userAgent: "SSR",
      language: "en-US",
      languages: ["en-US"],
      platform: "SSR",
      vendor: emptyString,
      onLine: true,
      cookieEnabled: false,
      mediaDevices: { getUserMedia: () => Promise.reject(new Error("SSR")) },
    },
    location: {
      href: emptyString,
      pathname: "/",
      search: emptyString,
      hash: emptyString,
      origin: emptyString,
      protocol: "https:",
      host: emptyString,
      hostname: emptyString,
      port: emptyString,
      assign: noop,
      replace: noop,
      reload: noop,
    },
    history: {
      length: 0,
      state: null,
      pushState: noop,
      replaceState: noop,
      go: noop,
      back: noop,
      forward: noop,
    },

    innerWidth: SSR_VIEWPORT_WIDTH,
    innerHeight: SSR_VIEWPORT_HEIGHT,
    outerWidth: SSR_VIEWPORT_WIDTH,
    outerHeight: SSR_VIEWPORT_HEIGHT,
    screenX: 0,
    screenY: 0,
    pageXOffset: 0,
    pageYOffset: 0,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 1,

    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    requestAnimationFrame: (cb: () => void) => globalThis.setTimeout(cb, 16),
    cancelAnimationFrame: globalThis.clearTimeout,

    localStorage: {
      getItem: noopNull,
      setItem: noop,
      removeItem: noop,
      clear: noop,
      length: 0,
      key: noopNull,
    },
    sessionStorage: {
      getItem: noopNull,
      setItem: noop,
      removeItem: noop,
      clear: noop,
      length: 0,
      key: noopNull,
    },

    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noopTrue,

    matchMedia: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: noop,
      removeListener: noop,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: noopTrue,
    }),

    getComputedStyle: () => ({ getPropertyValue: () => emptyString }),
    getSelection: noopNull,
    print: noop,
    alert: noop,
    confirm: noopFalse,
    prompt: noopNull,
    open: noopNull,
    close: noop,
    focus: noop,
    blur: noop,
    scroll: noop,
    scrollTo: noop,
    scrollBy: noop,
    resizeTo: noop,
    resizeBy: noop,
    moveTo: noop,
    moveBy: noop,

    crypto: globalThis.crypto,
    performance: globalThis.performance,
    fetch: globalThis.fetch,
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
  };
}

export function createElementClass(name: string): { new (): object } {
  const ElementClass = class {};
  Object.defineProperty(ElementClass, "name", { value: name });
  return ElementClass;
}
