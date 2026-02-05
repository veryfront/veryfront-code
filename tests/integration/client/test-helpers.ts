type GlobalWithBrowserAPIs = typeof globalThis & {
  location: Location;
  history: History;
  document: Document;
  IntersectionObserver: typeof IntersectionObserver;
  MutationObserver: typeof MutationObserver;
  DOMParser: typeof DOMParser;
  ReactDOM: unknown;
  requestIdleCallback: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback: (id: number) => void;
  MouseEvent: typeof MouseEvent;
  PopStateEvent: typeof PopStateEvent;
  fetch: typeof fetch;
};

export class MockIntersectionObserver {
  private callback: IntersectionObserverCallback;
  private options: IntersectionObserverInit;
  private observedElements = new Set<Element>();

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options ?? {};
  }

  observe(element: Element): void {
    this.observedElements.add(element);
  }

  unobserve(element: Element): void {
    this.observedElements.delete(element);
  }

  disconnect(): void {
    this.observedElements.clear();
  }

  triggerIntersection(element: Element, isIntersecting: boolean): void {
    const rect = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      top: 0,
      right: 100,
      bottom: 100,
      left: 0,
      toJSON: () => ({}),
    } as DOMRectReadOnly;

    const intersectionRect = {
      x: 0,
      y: 0,
      width: isIntersecting ? 100 : 0,
      height: isIntersecting ? 100 : 0,
      top: 0,
      right: isIntersecting ? 100 : 0,
      bottom: isIntersecting ? 100 : 0,
      left: 0,
      toJSON: () => ({}),
    } as DOMRectReadOnly;

    const entry: IntersectionObserverEntry = {
      target: element,
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0,
      boundingClientRect: rect,
      intersectionRect,
      rootBounds: null,
      time: Date.now(),
    };

    this.callback([entry], this as unknown as IntersectionObserver);
  }

  getObservedElements(): Set<Element> {
    return this.observedElements;
  }

  getOptions(): IntersectionObserverInit {
    return this.options;
  }
}

export class MockMutationObserver {
  private callback: MutationCallback;
  private config?: MutationObserverInit;

  constructor(callback: MutationCallback) {
    this.callback = callback;
  }

  observe(_target: Node, config?: MutationObserverInit): void {
    this.config = config;
  }

  disconnect(): void {
    // No-op
  }

  takeRecords(): MutationRecord[] {
    return [];
  }

  triggerMutation(mutation: Partial<MutationRecord>): void {
    const record: MutationRecord = {
      type: mutation.type ?? "childList",
      target: mutation.target ?? document.body,
      addedNodes: mutation.addedNodes ?? ([] as unknown as NodeList),
      removedNodes: mutation.removedNodes ?? ([] as unknown as NodeList),
      previousSibling: mutation.previousSibling ?? null,
      nextSibling: mutation.nextSibling ?? null,
      attributeName: mutation.attributeName ?? null,
      attributeNamespace: mutation.attributeNamespace ?? null,
      oldValue: mutation.oldValue ?? null,
    };

    this.callback([record], this as unknown as MutationObserver);
  }
}

export interface MockNetworkInformation {
  effectiveType: "4g" | "wifi" | "3g" | "2g" | "slow-2g";
  saveData: boolean;
  downlink?: number;
  rtt?: number;
}

export function createMockNavigator(
  connection?: Partial<MockNetworkInformation>,
): Navigator {
  const mockConnection: MockNetworkInformation = {
    effectiveType: connection?.effectiveType ?? "4g",
    saveData: connection?.saveData ?? false,
    downlink: connection?.downlink,
    rtt: connection?.rtt,
  };

  return {
    ...globalThis.navigator,
    connection: mockConnection,
  } as unknown as Navigator;
}

export interface MockHistory {
  state: any;
  length: number;
  scrollRestoration: ScrollRestoration;
  pushState(state: any, title: string, url?: string | URL | null): void;
  replaceState(state: any, title: string, url?: string | URL | null): void;
  go(delta?: number): void;
  back(): void;
  forward(): void;
}

export function createMockHistory(options?: {
  onPushState?: (state: any, title: string, url?: string | URL | null) => void;
  onReplaceState?: (state: any, title: string, url?: string | URL | null) => void;
}): MockHistory {
  let currentState: any = null;
  const states: any[] = [];
  let currentIndex = 0;

  function updateLocation(url?: string | URL | null): void {
    if (!url) return;

    const urlStr = typeof url === "string" ? url : url.toString();
    const global = globalThis as GlobalWithBrowserAPIs;
    (global.location as unknown as MockLocation).pathname = urlStr;
    (global.location as unknown as MockLocation).href = `${global.location.origin}${urlStr}`;
  }

  return {
    state: currentState,
    length: 1,
    scrollRestoration: "auto" as ScrollRestoration,

    pushState(state: any, title: string, url?: string | URL | null): void {
      currentState = state;
      states.push({ state, url });
      currentIndex = states.length - 1;
      options?.onPushState?.(state, title, url);
      updateLocation(url);
    },

    replaceState(state: any, title: string, url?: string | URL | null): void {
      currentState = state;
      if (states[currentIndex]) states[currentIndex] = { state, url };
      options?.onReplaceState?.(state, title, url);
      updateLocation(url);
    },

    go(delta?: number): void {
      if (!delta) return;

      const newIndex = currentIndex + delta;
      if (newIndex < 0 || newIndex >= states.length) return;

      currentIndex = newIndex;
      currentState = states[currentIndex].state;
    },

    back(): void {
      this.go(-1);
    },

    forward(): void {
      this.go(1);
    },
  };
}

export interface MockLocation {
  href: string;
  origin: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  reload(): void;
  replace(url: string): void;
  assign(url: string): void;
}

export function createMockLocation(url = "http://localhost:3000/"): MockLocation {
  const urlObj = new URL(url);

  return {
    href: urlObj.href,
    origin: urlObj.origin,
    protocol: urlObj.protocol,
    host: urlObj.host,
    hostname: urlObj.hostname,
    port: urlObj.port,
    pathname: urlObj.pathname,
    search: urlObj.search,
    hash: urlObj.hash,
    reload(): void {
      // No-op in tests
    },
    replace(url: string): void {
      const newUrl = new URL(url, this.origin);
      this.href = newUrl.href;
      this.pathname = newUrl.pathname;
      this.search = newUrl.search;
      this.hash = newUrl.hash;
    },
    assign(url: string): void {
      this.replace(url);
    },
  };
}

export function setupRequestIdleCallback(): void {
  const global = globalThis as GlobalWithBrowserAPIs;

  if (!global.requestIdleCallback) {
    global.requestIdleCallback = (callback: IdleRequestCallback) => {
      const start = Date.now();
      return setTimeout(() => {
        callback({
          didTimeout: false,
          timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
        });
      }, 1);
    };
  }

  if (!global.cancelIdleCallback) {
    global.cancelIdleCallback = (id: number) => {
      clearTimeout(id);
    };
  }
}

export class MockDOMParser {
  parseFromString(html: string, _type: DOMParserSupportedType): Document {
    const doc = {
      documentElement: null as unknown as HTMLElement,
      head: null as unknown as HTMLHeadElement,
      body: null as unknown as HTMLBodyElement,
      querySelectorAll(selector: string): NodeListOf<Element> {
        const elements: Element[] = [];

        if (selector.includes("script[src")) {
          const scriptMatches = html.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*>/g);
          for (const match of scriptMatches) {
            if (!match[1]) continue;
            const script = document.createElement("script");
            script.setAttribute("src", match[1]);
            elements.push(script);
          }
        }

        if (selector.includes('link[rel="stylesheet"]') || selector.includes("link")) {
          const linkMatches = html.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*>/g);
          for (const match of linkMatches) {
            if (!match[1]) continue;
            const link = document.createElement("link");
            link.setAttribute("href", match[1]);
            if (match[0].includes("stylesheet")) link.setAttribute("rel", "stylesheet");
            elements.push(link);
          }
        }

        if (selector.includes("script[data-veryfront-page]")) {
          const scriptMatches = html.matchAll(
            /<script[^>]*data-veryfront-page[^>]*>([\s\S]*?)<\/script>/g,
          );
          for (const match of scriptMatches) {
            const script = document.createElement("script");
            script.setAttribute("data-veryfront-page", "");
            script.textContent = match[1] ?? "";
            elements.push(script);
          }
        }

        return elements as unknown as NodeListOf<Element>;
      },
      querySelector(selector: string): Element | null {
        const all = this.querySelectorAll(selector);
        return all.length > 0 ? (all[0] ?? null) : null;
      },
      getElementById(id: string): Element | null {
        const idMatch = html.match(
          new RegExp(`<[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</[^>]+>`, "i"),
        );
        if (!idMatch) return null;

        const el = document.createElement("div");
        el.id = id;
        el.innerHTML = idMatch[1] ?? "";
        return el;
      },
      implementation: document.implementation,
    };

    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyDiv = document.createElement("div");
    bodyDiv.innerHTML = bodyMatch?.[1] ?? html;
    doc.body = bodyDiv as unknown as HTMLBodyElement;

    return doc as unknown as Document;
  }
}

export interface MockRoot {
  render(component: any): void;
  unmount(): void;
}

export const mockRoots = new Map<HTMLElement, MockRoot>();

export const mockReactDOM = {
  createRoot: (element: HTMLElement): MockRoot => {
    const root: MockRoot = {
      render(_component: any): void {
        // No-op in tests
      },
      unmount(): void {
        mockRoots.delete(element);
      },
    };
    mockRoots.set(element, root);
    return root;
  },
};

export type MockFetchResponse =
  | Response
  | Error
  | ((url: string, init?: RequestInit) => Response | Promise<Response>);

const originalFetch = globalThis.fetch;

export class FetchMock {
  private responses = new Map<string, MockFetchResponse>();

  set(url: string, response: MockFetchResponse): void {
    this.responses.set(url, response);
  }

  clear(): void {
    this.responses.clear();
  }

  install(): void {
    const global = globalThis as GlobalWithBrowserAPIs;

    global.fetch = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request).url;

      let response = this.responses.get(url);

      if (!response) {
        try {
          const urlObj = new URL(url);
          response = this.responses.get(urlObj.pathname + urlObj.search + urlObj.hash);
        } catch {
          // Not a valid URL, ignore
        }
      }

      if (response instanceof Error) throw response;

      if (typeof response === "function") {
        const result = response(url, init);
        return result instanceof Promise ? await result : result;
      }

      if (response) return response;

      return new Response("Not Found", { status: 404 });
    };
  }

  uninstall(): void {
    const global = globalThis as GlobalWithBrowserAPIs;
    global.fetch = originalFetch;
  }
}

/**
 * Helper function to match an element against a CSS selector
 * Supports: tag, [attr], [attr="value"], [attr='value']
 */
function matchesSelector(element: any, selector: string): boolean {
  if (!element || !selector) return false;

  const tagMatch = selector.match(/^([a-zA-Z]+)?/);
  const tag = tagMatch?.[1];

  if (tag && element.tagName?.toLowerCase() !== tag.toLowerCase()) return false;

  const attrPattern = /\[([a-zA-Z-]+)(?:=["']([^"']+)["'])?\]/g;
  let attrMatch: RegExpExecArray | null;

  while ((attrMatch = attrPattern.exec(selector)) !== null) {
    const attrName = attrMatch[1];
    const attrValue = attrMatch[2];

    if (!element.attributes) return false;
    if (!attrName) continue;

    if (attrValue !== undefined) {
      if (element.attributes[attrName] !== attrValue) return false;
    } else {
      if (!(attrName in element.attributes)) return false;
    }
  }

  return true;
}

type MockElement = {
  tagName: string;
  attributes: Record<string, string>;
  dataset: Record<string, string>;
  style: Record<string, string>;
  children: MockElement[];
  parentElement: MockElement | null;
  href?: string;
  hostname?: string;
  pathname?: string;
  hash?: string;
  target?: string;
  id?: string;
  className?: string;
  nodeType: number;
  nodeName: string;
  ownerDocument: unknown;
  textContent: string;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  hasAttribute: (name: string) => boolean;
  removeAttribute: (name: string) => void;
  appendChild: (child: MockElement) => MockElement;
  append: (...children: MockElement[]) => void;
  removeChild: (child: MockElement) => MockElement;
  querySelector: (selector: string) => MockElement | null;
  querySelectorAll: (selector: string) => MockElement[];
  dispatchEvent: (event: Event) => boolean;
  addEventListener: (type: string, listener: unknown) => void;
  removeEventListener: (type: string, listener: unknown) => void;
};

function createMinimalDocument(): any {
  const elementsById = new Map<string, MockElement>();

  const head = {
    _children: [] as MockElement[],
    appendChild(child: MockElement) {
      this._children.push(child);
      return child;
    },
    removeChild(child: MockElement) {
      const index = this._children.indexOf(child);
      if (index > -1) this._children.splice(index, 1);
      return child;
    },
    querySelector(selector: string) {
      return this._children.find((el) => matchesSelector(el, selector)) || null;
    },
    querySelectorAll(selector: string) {
      return this._children.filter((el) => matchesSelector(el, selector));
    },
  };

  const body = {
    classList: {
      _classes: new Set<string>(),
      add(...tokens: string[]) {
        for (const token of tokens) this._classes.add(token);
      },
      remove(...tokens: string[]) {
        for (const token of tokens) this._classes.delete(token);
      },
      toggle(token: string, force?: boolean) {
        if (force === true) {
          this._classes.add(token);
          return true;
        }
        if (force === false) {
          this._classes.delete(token);
          return false;
        }
        if (this._classes.has(token)) {
          this._classes.delete(token);
          return false;
        }
        this._classes.add(token);
        return true;
      },
      contains(token: string) {
        return this._classes.has(token);
      },
    },
    appendChild: (child: MockElement) => {
      body._children.push(child);
      if (child.id) elementsById.set(child.id, child);
      return child;
    },
    removeChild: (child: MockElement) => {
      const index = body._children.indexOf(child);
      if (index > -1) body._children.splice(index, 1);
      if (child.id) elementsById.delete(child.id);
      return child;
    },
    querySelector: (_selector: string) => null,
    querySelectorAll: (_selector: string) => [],
    _children: [] as MockElement[],
  };

  const doc: any = {
    head,
    body,
    title: "",
    addEventListener: (_type: string, _listener: unknown) => {},
    removeEventListener: (_type: string, _listener: unknown) => {},
    createElement: (tag: string): MockElement => {
      const el: MockElement = {
        tagName: tag.toUpperCase(),
        attributes: {},
        dataset: {},
        style: {},
        children: [],
        parentElement: null,
        href: "",
        hostname: "",
        pathname: "",
        hash: "",
        target: "",
        id: "",
        className: "",
        nodeType: 1,
        nodeName: tag.toUpperCase(),
        ownerDocument: doc,
        textContent: "",

        getAttribute(name: string) {
          return this.attributes[name] || null;
        },
        setAttribute(name: string, value: string) {
          this.attributes[name] = value;

          if (name === "data-prefetch") this.dataset.prefetch = value;
          if (name === "data-no-prefetch") this.dataset.noPrefetch = value;

          if (name === "id") {
            this.id = value;
            elementsById.set(value, this);
          }
        },
        hasAttribute(name: string) {
          return name in this.attributes;
        },
        removeAttribute(name: string) {
          delete this.attributes[name];
        },
        appendChild(child: MockElement) {
          this.children.push(child);
          child.parentElement = this;
          return child;
        },
        append(...children: MockElement[]) {
          for (const child of children) {
            this.children.push(child);
            child.parentElement = this;
          }
        },
        removeChild(child: MockElement) {
          const index = this.children.indexOf(child);
          if (index > -1) {
            this.children.splice(index, 1);
            child.parentElement = null;
          }
          return child;
        },
        querySelector: (_selector: string) => null,
        querySelectorAll: (_selector: string) => [],
        dispatchEvent: (_event: Event) => true,
        addEventListener: (_type: string, _listener: unknown) => {},
        removeEventListener: (_type: string, _listener: unknown) => {},
      };

      if (tag === "a") {
        Object.defineProperty(el, "href", {
          get() {
            if (!this._href) return "";
            try {
              const global = globalThis as GlobalWithBrowserAPIs;
              const url = new URL(this._href, global.location?.origin || "http://localhost:3000");
              return url.href;
            } catch {
              return this._href;
            }
          },
          set(value: string) {
            this._href = value;
            this.attributes.href = value;
            try {
              const global = globalThis as GlobalWithBrowserAPIs;
              const url = new URL(value, global.location?.origin || "http://localhost:3000");
              this.hostname = url.hostname;
              this.pathname = url.pathname;
              this.hash = url.hash;
            } catch {
              // Invalid URL, keep as is
            }
          },
        });
      }

      if (tag === "link") {
        Object.defineProperty(el, "rel", {
          get() {
            return this.attributes.rel || "";
          },
          set(value: string) {
            this.attributes.rel = value;
          },
        });
        Object.defineProperty(el, "href", {
          get() {
            return this.attributes.href || "";
          },
          set(value: string) {
            this.attributes.href = value;
          },
        });
      }

      if (el.id) elementsById.set(el.id, el);

      return el;
    },
    querySelector: (selector: string) => {
      if (selector.startsWith("#")) {
        const id = selector.slice(1);
        return elementsById.get(id) || null;
      }

      if (selector === 'meta[name="description"]') {
        const meta = doc.createElement("meta");
        meta.setAttribute("name", "description");
        return meta;
      }

      const allChildren = [...head._children, ...body._children];
      return allChildren.find((el) => matchesSelector(el, selector)) || null;
    },
    querySelectorAll: (selector: string) => {
      const allChildren = [...head._children, ...body._children];
      return allChildren.filter((el) => matchesSelector(el, selector));
    },
    getElementById: (id: string) => elementsById.get(id) || null,
    implementation: {
      createHTMLDocument: (_title: string) => createMinimalDocument(),
    },
  };

  return doc;
}

export interface DOMEnvironmentOptions {
  url?: string;
  connection?: Partial<MockNetworkInformation>;
  trackObservers?: boolean;
}

export interface DOMEnvironment {
  cleanup: () => void;
  mockObservers: MockIntersectionObserver[];
  fetchMock: FetchMock;
  location: MockLocation;
  history: MockHistory;
}

export function setupDOMEnvironment(options: DOMEnvironmentOptions = {}): DOMEnvironment {
  const mockObservers: MockIntersectionObserver[] = [];
  const fetchMock = new FetchMock();
  const global = globalThis as GlobalWithBrowserAPIs;

  const originalDocument = global.document;
  const originalIntersectionObserver = global.IntersectionObserver;
  const originalMutationObserver = global.MutationObserver;
  const originalDOMParser = global.DOMParser;
  const originalNavigator = globalThis.navigator;
  const originalLocation = global.location;
  const originalHistory = global.history;
  const originalReactDOM = global.ReactDOM;
  const originalAddEventListener = globalThis.addEventListener;
  const originalRemoveEventListener = globalThis.removeEventListener;
  const originalScrollTo = (globalThis as any).scrollTo;

  const eventListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  if (typeof globalThis.addEventListener !== "function") {
    (globalThis as any).addEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      let listeners = eventListeners.get(type);
      if (!listeners) {
        listeners = new Set();
        eventListeners.set(type, listeners);
      }
      listeners.add(listener);
    };
  }

  if (typeof globalThis.removeEventListener !== "function") {
    (globalThis as any).removeEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      eventListeners.get(type)?.delete(listener);
    };
  }

  if (typeof globalThis.dispatchEvent !== "function") {
    (globalThis as any).dispatchEvent = (event: Event) => {
      const listeners = eventListeners.get(event.type);
      if (!listeners) return true;

      for (const listener of listeners) {
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
      return true;
    };
  }

  if (typeof (globalThis as any).scrollTo !== "function") {
    (globalThis as any).scrollTo = (_x: number, _y: number) => {
      // No-op in tests
    };
  }

  const isSSRStubDocument = (originalDocument as any)?.__veryfrontSSRStub === true;
  if (
    !originalDocument || typeof originalDocument.createElement !== "function" || isSSRStubDocument
  ) {
    global.document = createMinimalDocument() as unknown as Document;
  }

  global.IntersectionObserver = class extends MockIntersectionObserver {
    constructor(callback: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
      super(callback, opts);
      if (options.trackObservers !== false) mockObservers.push(this);
    }
  } as unknown as typeof IntersectionObserver;

  global.MutationObserver = MockMutationObserver as unknown as typeof MutationObserver;
  global.DOMParser = MockDOMParser as unknown as typeof DOMParser;

  const mockNavigator = createMockNavigator(options.connection);
  Object.defineProperty(globalThis, "navigator", {
    value: mockNavigator,
    writable: true,
    configurable: true,
  });

  const mockLocation = createMockLocation(options.url);
  global.location = mockLocation as unknown as Location;

  const mockHistory = createMockHistory();
  global.history = mockHistory as unknown as History;

  global.ReactDOM = mockReactDOM;

  if (typeof global.MouseEvent === "undefined") {
    global.MouseEvent = class MockMouseEvent extends Event {
      constructor(type: string, eventInitDict?: MouseEventInit) {
        super(type, eventInitDict);
      }
    } as unknown as typeof MouseEvent;
  }

  if (typeof global.PopStateEvent === "undefined") {
    global.PopStateEvent = class MockPopStateEvent extends Event {
      constructor(type: string, eventInitDict?: PopStateEventInit) {
        super(type, eventInitDict);
      }
    } as unknown as typeof PopStateEvent;
  }

  setupRequestIdleCallback();
  fetchMock.install();

  const cleanup = (): void => {
    global.document = originalDocument;
    global.IntersectionObserver = originalIntersectionObserver;
    global.MutationObserver = originalMutationObserver;
    global.DOMParser = originalDOMParser;

    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });

    global.location = originalLocation;
    global.history = originalHistory;
    global.ReactDOM = originalReactDOM;

    if (originalAddEventListener) (globalThis as any).addEventListener = originalAddEventListener;
    else delete (globalThis as any).addEventListener;

    if (originalRemoveEventListener) {
      (globalThis as any).removeEventListener = originalRemoveEventListener;
    } else delete (globalThis as any).removeEventListener;

    if (originalScrollTo) (globalThis as any).scrollTo = originalScrollTo;
    else delete (globalThis as any).scrollTo;

    fetchMock.uninstall();
    mockObservers.length = 0;
    mockRoots.clear();
    eventListeners.clear();
  };

  return {
    cleanup,
    mockObservers,
    fetchMock,
    location: mockLocation,
    history: mockHistory,
  };
}
