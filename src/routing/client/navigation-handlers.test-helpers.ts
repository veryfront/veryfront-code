interface MockElement {
  tagName?: string;
  getAttribute?: (name: string) => string | null;
  parentElement?: MockElement | null;
  _attributes?: Map<string, string>;
}

interface MockLocation {
  pathname: string;
  search: string;
  hash: string;
}

export function setupNavigationHandlerMocks(): {
  mockLocation: MockLocation;
  setScrollY: (value: number) => void;
  cleanup: () => void;
} {
  const g = globalThis as any;

  const originalLocation = g.location;
  const originalScrollY = g.scrollY;
  const originalHTMLAnchorElement = g.HTMLAnchorElement;
  const originalHTMLElement = g.HTMLElement;

  const mockLocation: MockLocation = { pathname: "/current-page", search: "", hash: "" };

  class MockHTMLElement {
    tagName = "";
    private _attributes = new Map<string, string>();

    getAttribute(name: string): string | null {
      return this._attributes.get(name) ?? null;
    }

    setAttribute(name: string, value: string): void {
      this._attributes.set(name, value);
    }

    hasAttribute(name: string): boolean {
      return this._attributes.has(name);
    }
  }

  class MockHTMLAnchorElement extends MockHTMLElement {
    constructor() {
      super();
      this.tagName = "A";
    }
  }

  g.location = mockLocation;
  g.scrollY = 0;
  g.HTMLElement = MockHTMLElement;
  g.HTMLAnchorElement = MockHTMLAnchorElement;

  return {
    mockLocation,
    setScrollY(value: number) {
      g.scrollY = value;
    },
    cleanup() {
      g.location = originalLocation;
      g.scrollY = originalScrollY;
      g.HTMLAnchorElement = originalHTMLAnchorElement;
      g.HTMLElement = originalHTMLElement;
    },
  };
}

export function createMockAnchor(
  href: string,
  attributes: Record<string, string> = {},
): any {
  const MockHTMLAnchorElement = (globalThis as any).HTMLAnchorElement;
  if (!MockHTMLAnchorElement) {
    throw new Error("MockHTMLAnchorElement not set up. Call setupNavigationHandlerMocks() first.");
  }

  const anchor = new MockHTMLAnchorElement();
  anchor.setAttribute("href", href);

  for (const [key, value] of Object.entries(attributes)) {
    anchor.setAttribute(key, value);
  }

  anchor.parentElement = null;
  return anchor;
}

export function createMockElement(
  tagName: string,
  attributes: Record<string, string> = {},
): MockElement {
  const MockHTMLElement = (globalThis as any).HTMLElement;
  if (!MockHTMLElement) {
    const attrs = new Map<string, string>(Object.entries(attributes));
    return {
      tagName: tagName.toUpperCase(),
      getAttribute: (name: string) => attrs.get(name) ?? null,
      parentElement: null,
      _attributes: attrs,
    };
  }

  const element = new MockHTMLElement();
  element.tagName = tagName.toUpperCase();

  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }

  element.parentElement = null;
  return element as MockElement;
}
