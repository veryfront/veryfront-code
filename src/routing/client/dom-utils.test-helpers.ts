export type GlobalWithDOM = typeof globalThis & {
  HTMLAnchorElement: typeof HTMLAnchorElement;
  HTMLElement: typeof HTMLElement;
  Element: typeof Element;
  document: Document;
};

const originalHTMLAnchorElement = (globalThis as GlobalWithDOM).HTMLAnchorElement;
const originalHTMLElement = (globalThis as GlobalWithDOM).HTMLElement;
const originalElement = (globalThis as GlobalWithDOM).Element;

class MockHTMLAnchorElement {
  tagName = "A";
  parentElement: MockHTMLElement | MockHTMLAnchorElement | null = null;
  private attrs = new Map<string, string>();

  constructor(href = "", attributes: Record<string, string> = {}) {
    this.attrs.set("href", href);
    for (const [key, value] of Object.entries(attributes)) this.attrs.set(key, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
}

export class MockHTMLElement {
  tagName: string;
  parentElement: MockHTMLElement | MockHTMLAnchorElement | null = null;
  private attrs = new Map<string, string>();

  constructor(
    tagName: string,
    attributes: Record<string, string> = {},
    parent: MockHTMLElement | MockHTMLAnchorElement | null = null,
  ) {
    this.tagName = tagName.toUpperCase();
    this.parentElement = parent;
    for (const [key, value] of Object.entries(attributes)) this.attrs.set(key, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  querySelector(_selector: string): HTMLElement | null {
    return null;
  }

  focus(_options?: { preventScroll?: boolean }): void {
  }
}

export class MockElement {
  tagName: string;
  attributes: Array<{ name: string; value: string }> = [];
  textContent: string | null = null;
  childNodes: unknown[] = [];
  parentElement: MockElement | null = null;

  constructor(tagName = "DIV") {
    this.tagName = tagName.toUpperCase();
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }

    this.attributes.push({ name, value });
  }

  hasAttribute(name: string): boolean {
    return this.attributes.some((attribute) => attribute.name === name);
  }
}

export function createMockAnchor(
  href: string,
  attributes: Record<string, string> = {},
): HTMLAnchorElement {
  return new MockHTMLAnchorElement(href, attributes) as unknown as HTMLAnchorElement;
}

export function createMockElement(
  tagName: string,
  attributes: Record<string, string> = {},
  parent: HTMLElement | HTMLAnchorElement | null = null,
): HTMLElement {
  return new MockHTMLElement(
    tagName,
    attributes,
    parent as unknown as MockHTMLElement | MockHTMLAnchorElement | null,
  ) as unknown as HTMLElement;
}

function setupGlobalMock<K extends keyof GlobalWithDOM>(
  key: K,
  value: GlobalWithDOM[K],
  original: GlobalWithDOM[K],
): { cleanup: () => void } {
  (globalThis as GlobalWithDOM)[key] = value;
  return {
    cleanup: () => {
      (globalThis as GlobalWithDOM)[key] = original;
    },
  };
}

export function setupHTMLAnchorElementMock(): { cleanup: () => void } {
  return setupGlobalMock(
    "HTMLAnchorElement",
    MockHTMLAnchorElement as unknown as typeof HTMLAnchorElement,
    originalHTMLAnchorElement,
  );
}

export function setupHTMLElementMock(): { cleanup: () => void } {
  return setupGlobalMock(
    "HTMLElement",
    MockHTMLElement as unknown as typeof HTMLElement,
    originalHTMLElement,
  );
}

export function setupElementMock(): { cleanup: () => void } {
  return setupGlobalMock("Element", MockElement as unknown as typeof Element, originalElement);
}

export function setupDOMMocks(): { cleanup: () => void } {
  const htmlAnchorMock = setupHTMLAnchorElementMock();
  const htmlElementMock = setupHTMLElementMock();
  const elementMock = setupElementMock();

  return {
    cleanup: () => {
      htmlAnchorMock.cleanup();
      htmlElementMock.cleanup();
      elementMock.cleanup();
    },
  };
}
