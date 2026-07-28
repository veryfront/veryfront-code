import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { useUpload, type UseUploadResult } from "./use-upload.ts";

class PendingXMLHttpRequest {
  static instances: PendingXMLHttpRequest[] = [];

  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  responseText = "";
  status = 0;
  aborted = false;

  constructor() {
    PendingXMLHttpRequest.instances.push(this);
  }

  open(): void {}
  setRequestHeader(): void {}
  send(): void {}

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.onabort?.();
  }
}

function installDom(): { restore: () => void; revokedObjectURLs: string[] } {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://example.com/",
  });
  const window = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
    "XMLHttpRequest",
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));

  const replacements = {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    XMLHttpRequest: PendingXMLHttpRequest,
  };
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const revoked: string[] = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:test-preview",
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => revoked.push(url),
    writable: true,
  });

  return {
    revokedObjectURLs: revoked,
    restore: () => {
      if (createDescriptor) Object.defineProperty(URL, "createObjectURL", createDescriptor);
      else delete (URL as unknown as Record<string, unknown>).createObjectURL;
      if (revokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
      else delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
      for (const key of keys) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      dom.window.close();
    },
  };
}

describe("useUpload", () => {
  it("aborts pending uploads and releases previews on unmount", () => {
    const dom = installDom();
    PendingXMLHttpRequest.instances = [];
    let latest: UseUploadResult | null = null;

    try {
      const Capture = (): null => {
        latest = useUpload({ api: "/api/uploads" });
        return null;
      };
      const rootElement = document.getElementById("root");
      assert(rootElement);
      const root = createRoot(rootElement);
      flushSync(() => root.render(<Capture />));

      const file = new File(["image"], "preview.png", { type: "image/png" });
      flushSync(() => latest?.upload([file]));
      assertEquals(PendingXMLHttpRequest.instances.length, 1);
      assertEquals((latest as unknown as UseUploadResult).attachments.length, 1);

      flushSync(() => root.unmount());

      assertEquals(PendingXMLHttpRequest.instances[0]?.aborted, true);
      assertEquals(dom.revokedObjectURLs, ["blob:test-preview"]);
    } finally {
      dom.restore();
    }
  });
});
