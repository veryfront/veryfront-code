import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import {
  createUploadId,
  INLINE_ATTACHMENT_MAX_BYTES,
  parseChatUploadResponse,
  useUpload,
  type UseUploadResult,
} from "./use-upload.ts";

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
  abortError: unknown;
  readonly requestHeaders = new Map<string, string>();
  url = "";

  constructor() {
    PendingXMLHttpRequest.instances.push(this);
  }

  open(_method: string, url: string): void {
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.requestHeaders.set(name.toLowerCase(), value);
  }
  send(): void {}

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    if (this.abortError !== undefined) throw this.abortError;
    this.onabort?.();
  }

  respond(status: number, responseText: string): void {
    this.status = status;
    this.responseText = responseText;
    this.onload?.();
  }
}

class PendingFileReader {
  static readonly EMPTY = 0;
  static readonly LOADING = 1;
  static readonly DONE = 2;
  static instances: PendingFileReader[] = [];

  readonly EMPTY = PendingFileReader.EMPTY;
  readonly LOADING = PendingFileReader.LOADING;
  readonly DONE = PendingFileReader.DONE;
  readyState = PendingFileReader.EMPTY;
  result: string | ArrayBuffer | null = null;
  error: DOMException | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  aborted = false;

  constructor() {
    PendingFileReader.instances.push(this);
  }

  readAsDataURL(): void {
    this.readyState = PendingFileReader.LOADING;
  }

  abort(): void {
    if (this.readyState !== PendingFileReader.LOADING) return;
    this.aborted = true;
    this.readyState = PendingFileReader.DONE;
    this.onabort?.();
  }

  resolve(result: string): void {
    this.result = result;
    this.readyState = PendingFileReader.DONE;
    this.onload?.();
  }
}

function installDom(): {
  restore: () => void;
  createdObjectURLs: string[];
  revokedObjectURLs: string[];
} {
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
    "FileReader",
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
    FileReader: PendingFileReader,
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
  const created: string[] = [];
  const revoked: string[] = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => {
      const url = `blob:test-preview-${created.length + 1}`;
      created.push(url);
      return url;
    },
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => revoked.push(url),
    writable: true,
  });

  return {
    createdObjectURLs: created,
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

/**
 * Unmount and drain the scheduler task React leaves behind.
 *
 * React's scheduler holds a `setImmediate` until it next runs. It completes on
 * its own, but the test has to yield once more or Deno's leak sanitizer sees
 * the timer still pending.
 */
async function unmount(root: Root): Promise<void> {
  flushSync(() => root.unmount());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useUpload", () => {
  it("creates collision-resistant attachment ids with Web Crypto", () => {
    assertEquals(
      createUploadId({
        randomUUID: () => "12345678-1234-4234-8234-123456789abc",
      }),
      "upload-12345678-1234-4234-8234-123456789abc",
    );
    assertEquals(
      createUploadId({
        getRandomValues(array) {
          new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0);
          return array;
        },
      }),
      "upload-00000000-0000-4000-8000-000000000000",
    );
  });

  it("fails closed when Web Crypto cannot provide a safe attachment id", () => {
    assertThrows(
      () => createUploadId(null),
      Error,
      "File uploads require crypto.randomUUID() or crypto.getRandomValues()",
    );
    assertThrows(
      () => createUploadId({ randomUUID: () => "" }),
      TypeError,
      "crypto.randomUUID() returned an invalid upload identifier",
    );
  });

  it("preserves Web Crypto error identity", () => {
    const expected = new Error("entropy source failed");
    let actual: unknown;

    try {
      createUploadId({
        getRandomValues() {
          throw expected;
        },
      });
    } catch (error) {
      actual = error;
    }

    assertStrictEquals(actual, expected);
  });

  it("releases previews and preserves the allocation error when a batch cannot finish", async () => {
    const dom = installDom();
    let latest: UseUploadResult | null = null;
    const createObjectURL = URL.createObjectURL;
    const allocationError = new Error("preview allocation failed");
    let allocationCount = 0;

    try {
      URL.createObjectURL = (blob) => {
        allocationCount += 1;
        if (allocationCount === 2) throw allocationError;
        return createObjectURL(blob);
      };
      const Capture = (): null => {
        latest = useUpload({ url: "/api/uploads" });
        return null;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => root.render(<Capture />));

      let actual: unknown;
      try {
        flushSync(() =>
          latest?.upload([
            new File(["one"], "one.png", { type: "image/png" }),
            new File(["two"], "two.png", { type: "image/png" }),
          ])
        );
      } catch (error) {
        actual = error;
      }

      assertStrictEquals(actual, allocationError);
      assertEquals(dom.revokedObjectURLs, ["blob:test-preview-1"]);
      assertEquals((latest as unknown as UseUploadResult).attachments, []);
      await unmount(root);
    } finally {
      dom.restore();
    }
  });

  it("bounds durable response bytes rather than UTF-16 code units", () => {
    const oversizedUnicode = JSON.stringify({
      url: "/uploads/report.txt",
      ignored: "€".repeat(30_000),
    });
    assert(
      oversizedUnicode.length < 64 * 1024,
      "the fixture must fit the old code-unit-only limit",
    );
    assertEquals(parseChatUploadResponse(oversizedUnicode), null);
  });

  it("clamps transport progress to the documented percentage range", async () => {
    const dom = installDom();
    PendingXMLHttpRequest.instances = [];
    let latest: UseUploadResult | null = null;

    try {
      const Capture = (): null => {
        latest = useUpload({ url: "/api/uploads" });
        return null;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => root.render(<Capture />));
      flushSync(() => latest?.upload([new File(["x"], "report.txt")]));

      const request = PendingXMLHttpRequest.instances[0]!;
      flushSync(() =>
        request.upload.onprogress?.({
          lengthComputable: true,
          loaded: 2,
          total: 1,
        } as ProgressEvent)
      );
      assertEquals(
        (latest as unknown as UseUploadResult).attachments[0]?.progress,
        100,
      );
      await unmount(root);
    } finally {
      dom.restore();
    }
  });

  it("classifies every transport failure as an errored attachment", async () => {
    const dom = installDom();
    PendingXMLHttpRequest.instances = [];
    let latest: UseUploadResult | null = null;

    try {
      const Capture = (): null => {
        latest = useUpload({ url: "/api/uploads" });
        return null;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => root.render(<Capture />));
      flushSync(() =>
        latest?.upload([
          new File(["a"], "rejected.txt"),
          new File(["b"], "unparsable.txt"),
          new File(["c"], "unsafe.txt"),
          new File(["d"], "offline.txt"),
        ])
      );

      const [rejected, unparsable, unsafe, offline] = PendingXMLHttpRequest.instances;
      flushSync(() => rejected!.respond(500, '{"url":"https://cdn.example.com/report.txt"}'));
      flushSync(() => unparsable!.respond(200, "<html>not json</html>"));
      flushSync(() => unsafe!.respond(200, '{"url":"javascript:alert(1)"}'));
      flushSync(() => offline!.onerror?.());

      const attachments = (latest as unknown as UseUploadResult).attachments;
      assertEquals(
        attachments.map((attachment) => attachment.state),
        ["error", "error", "error", "error"],
        "a non-2xx status, an unparsable body, an unsafe URL and a transport error all error out",
      );
      assertEquals(
        attachments.map((attachment) => attachment.url),
        [undefined, undefined, undefined, undefined],
        "a failed upload never admits a URL",
      );
      await unmount(root);
    } finally {
      dom.restore();
    }
  });

  it("aborts pending uploads and releases previews on unmount", async () => {
    const dom = installDom();
    PendingXMLHttpRequest.instances = [];
    let latest: UseUploadResult | null = null;

    try {
      const Capture = (): null => {
        latest = useUpload({ url: "/api/uploads" });
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

      await unmount(root);

      assertEquals(PendingXMLHttpRequest.instances[0]?.aborted, true);
      assertEquals(dom.revokedObjectURLs, ["blob:test-preview-1"]);
    } finally {
      dom.restore();
    }
  });

  it("finishes clear cleanup and reports transport abort errors exactly", async () => {
    const dom = installDom();
    PendingXMLHttpRequest.instances = [];
    const previousReportError = (globalThis as { reportError?: (error: unknown) => void })
      .reportError;
    const reported: unknown[] = [];
    (globalThis as { reportError?: (error: unknown) => void }).reportError = (error) => {
      reported.push(error);
    };
    let latest: UseUploadResult | null = null;

    try {
      const Capture = (): null => {
        latest = useUpload({ url: "/api/uploads" });
        return null;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => root.render(<Capture />));
      flushSync(() =>
        latest?.upload([
          new File(["one"], "one.png", { type: "image/png" }),
          new File(["two"], "two.png", { type: "image/png" }),
        ])
      );

      const abortError = new Error("transport abort failed");
      PendingXMLHttpRequest.instances[0]!.abortError = abortError;
      flushSync(() => latest?.clear());

      assertEquals(PendingXMLHttpRequest.instances.map((request) => request.aborted), [true, true]);
      assertEquals(dom.revokedObjectURLs, ["blob:test-preview-1", "blob:test-preview-2"]);
      assertEquals((latest as unknown as UseUploadResult).attachments, []);
      assertEquals(reported.length, 1);
      assertStrictEquals(reported[0], abortError);
      await unmount(root);
    } finally {
      if (previousReportError) {
        (globalThis as { reportError?: (error: unknown) => void }).reportError =
          previousReportError;
      } else {
        delete (globalThis as { reportError?: (error: unknown) => void }).reportError;
      }
      dom.restore();
    }
  });

  it("uses the latest retry and ignores a late completion from the aborted request", async () => {
    const dom = installDom();
    PendingXMLHttpRequest.instances = [];
    let latest: UseUploadResult | null = null;

    try {
      const Capture = (): null => {
        latest = useUpload({ url: "/api/uploads" });
        return null;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => root.render(<Capture />));
      flushSync(() => latest?.upload([new File(["x"], "report.txt")]));

      const first = PendingXMLHttpRequest.instances[0]!;
      const staleOnload = first.onload;
      const id = (latest as unknown as UseUploadResult).attachments[0]!.id;
      flushSync(() => latest?.retry(id));
      const second = PendingXMLHttpRequest.instances[1]!;
      assertEquals(first.aborted, true);

      flushSync(() =>
        second.respond(200, '{"url":"https://cdn.example.com/current.txt","id":"current"}')
      );
      first.status = 200;
      first.responseText = '{"url":"https://cdn.example.com/stale.txt","id":"stale"}';
      flushSync(() => staleOnload?.());

      assertEquals(
        (latest as unknown as UseUploadResult).attachments[0]?.url,
        "https://cdn.example.com/current.txt",
      );
      assertEquals((latest as unknown as UseUploadResult).attachments[0]?.uploadId, "current");
      await unmount(root);
    } finally {
      dom.restore();
    }
  });

  it("aborts endpoint-owned work and prevents its late callbacks from mutating a retry", async () => {
    const dom = installDom();
    PendingXMLHttpRequest.instances = [];
    let latest: UseUploadResult | null = null;

    try {
      const Capture = ({ url }: { url: string }): null => {
        latest = useUpload({ url });
        return null;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => root.render(<Capture url="/old" />));
      flushSync(() => latest?.upload([new File(["x"], "report.txt")]));
      const oldRequest = PendingXMLHttpRequest.instances[0]!;
      const id = (latest as unknown as UseUploadResult).attachments[0]!.id;

      flushSync(() => root.render(<Capture url="/new" />));
      await new Promise((resolve) => setTimeout(resolve, 0));
      flushSync(() => {});
      assertEquals(oldRequest.aborted, true);
      assertEquals((latest as unknown as UseUploadResult).attachments[0]?.state, "error");

      flushSync(() => latest?.retry(id));
      const currentRequest = PendingXMLHttpRequest.instances[1]!;
      assertEquals(currentRequest.url, "/new");
      flushSync(() =>
        currentRequest.respond(
          200,
          '{"url":"https://cdn.example.com/current.txt","id":"current"}',
        )
      );
      flushSync(() =>
        oldRequest.respond(200, '{"url":"https://cdn.example.com/stale.txt","id":"stale"}')
      );

      assertEquals(
        (latest as unknown as UseUploadResult).attachments[0]?.url,
        "https://cdn.example.com/current.txt",
      );
      await unmount(root);
    } finally {
      dom.restore();
    }
  });

  it("accepts a new-scope upload from a descendant layout effect during handoff", async () => {
    const dom = installDom();
    PendingXMLHttpRequest.instances = [];
    let latest: UseUploadResult | null = null;

    try {
      const Child = (
        { upload, run }: { upload: UseUploadResult["upload"]; run: boolean },
      ): null => {
        React.useLayoutEffect(() => {
          if (run) upload([new File(["new"], "new.txt")]);
        }, [run, upload]);
        return null;
      };
      const Capture = (
        { url, authorization, run }: { url: string; authorization: string; run: boolean },
      ): React.JSX.Element => {
        latest = useUpload({ url, headers: { authorization } });
        return <Child upload={latest.upload} run={run} />;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => root.render(<Capture url="/old" authorization="Bearer old" run={false} />));
      flushSync(() => root.render(<Capture url="/new" authorization="Bearer new" run />));

      assertEquals(PendingXMLHttpRequest.instances.length, 1);
      assertEquals(PendingXMLHttpRequest.instances[0]?.url, "/new");
      assertEquals(
        PendingXMLHttpRequest.instances[0]?.requestHeaders.get("authorization"),
        "Bearer new",
      );
      assertEquals((latest as unknown as UseUploadResult).attachments.length, 1);
      await unmount(root);
    } finally {
      dom.restore();
    }
  });

  it("removal aborts ownership and a late callback cannot resurrect the attachment", async () => {
    const dom = installDom();
    PendingXMLHttpRequest.instances = [];
    let latest: UseUploadResult | null = null;

    try {
      const Capture = (): null => {
        latest = useUpload({ url: "/api/uploads" });
        return null;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => root.render(<Capture />));
      flushSync(() => latest?.upload([new File(["x"], "report.txt")]));
      const request = PendingXMLHttpRequest.instances[0]!;
      const staleOnload = request.onload;
      const id = (latest as unknown as UseUploadResult).attachments[0]!.id;

      flushSync(() => latest?.remove(id));
      assertEquals(request.aborted, true);
      assertEquals((latest as unknown as UseUploadResult).attachments, []);

      request.status = 200;
      request.responseText = '{"url":"https://cdn.example.com/late.txt","id":"late"}';
      flushSync(() => staleOnload?.());
      assertEquals((latest as unknown as UseUploadResult).attachments, []);
      await unmount(root);
    } finally {
      dom.restore();
    }
  });

  it("inline retries are epoch-owned and keep only the latest FileReader result", async () => {
    const dom = installDom();
    PendingFileReader.instances = [];
    let latest: UseUploadResult | null = null;

    try {
      const Capture = (): null => {
        latest = useUpload();
        return null;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => root.render(<Capture />));
      flushSync(() => latest?.upload([new File(["x"], "report.txt")]));
      const first = PendingFileReader.instances[0]!;
      const staleOnload = first.onload;
      const id = (latest as unknown as UseUploadResult).attachments[0]!.id;

      flushSync(() => latest?.retry(id));
      const second = PendingFileReader.instances[1]!;
      assertEquals(first.aborted, true);
      flushSync(() => second.resolve("data:text/plain;base64,Y3VycmVudA=="));
      first.result = "data:text/plain;base64,c3RhbGU=";
      flushSync(() => staleOnload?.());

      assertEquals(
        (latest as unknown as UseUploadResult).attachments[0]?.url,
        "data:text/plain;base64,Y3VycmVudA==",
      );
      await unmount(root);
    } finally {
      dom.restore();
    }
  });

  it("rejects a guest-mode file over the inline size cap without reading it", async () => {
    const dom = installDom();
    PendingFileReader.instances = [];
    let latest: UseUploadResult | null = null;

    try {
      const Capture = (): null => {
        latest = useUpload();
        return null;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => root.render(<Capture />));
      flushSync(() =>
        latest?.upload([new File([new Uint8Array(INLINE_ATTACHMENT_MAX_BYTES + 1)], "over.bin")])
      );

      assertEquals(
        (latest as unknown as UseUploadResult).attachments[0]?.state,
        "error",
        "an oversized guest-mode file settles as error",
      );
      assertEquals(
        PendingFileReader.instances.length,
        0,
        "the oversized file is never handed to a FileReader",
      );

      flushSync(() =>
        latest?.upload([new File([new Uint8Array(INLINE_ATTACHMENT_MAX_BYTES)], "at-cap.bin")])
      );
      assertEquals(
        PendingFileReader.instances.length,
        1,
        "a file at exactly the cap is still read inline",
      );
      assertEquals(
        (latest as unknown as UseUploadResult).attachments[1]?.state,
        "uploading",
        "a file at exactly the cap stays in flight",
      );
      await unmount(root);
    } finally {
      dom.restore();
    }
  });

  it("retained callbacks are inert after unmount and allocate no previews", async () => {
    const dom = installDom();
    PendingXMLHttpRequest.instances = [];
    let latest: UseUploadResult | null = null;

    try {
      const Capture = (): null => {
        latest = useUpload({ url: "/api/uploads" });
        return null;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => root.render(<Capture />));
      const retained = latest as unknown as UseUploadResult;
      await unmount(root);

      retained.upload([new File(["image"], "late.png", { type: "image/png" })]);
      retained.remove("missing");
      retained.retry("missing");
      retained.clear();

      assertEquals(dom.createdObjectURLs, []);
      assertEquals(PendingXMLHttpRequest.instances, []);
    } finally {
      dom.restore();
    }
  });

  it("an abandoned concurrent endpoint render cannot steal committed operation ownership", async () => {
    const dom = installDom();
    PendingXMLHttpRequest.instances = [];
    let committed: UseUploadResult | null = null;
    let attemptedSuspendedRender = false;
    const never = new Promise<void>(() => undefined);

    try {
      const Capture = (
        { url, suspend = false }: { url: string; suspend?: boolean },
      ): null => {
        const result = useUpload({ url });
        React.useLayoutEffect(() => {
          committed = result;
        });
        if (suspend) {
          attemptedSuspendedRender = true;
          throw never;
        }
        return null;
      };
      const root = createRoot(document.getElementById("root")!);
      flushSync(() =>
        root.render(
          <React.Suspense fallback={null}>
            <Capture url="/committed" />
          </React.Suspense>,
        )
      );
      flushSync(() => committed?.upload([new File(["x"], "report.txt")]));
      const request = PendingXMLHttpRequest.instances[0]!;

      React.startTransition(() => {
        root.render(
          <React.Suspense fallback={null}>
            <Capture url="/abandoned" suspend />
          </React.Suspense>,
        );
      });
      await waitFor(() => attemptedSuspendedRender, {
        interval: 1,
        message: "Concurrent upload render did not start",
      });
      assertEquals(attemptedSuspendedRender, true);
      assertEquals(request.aborted, false);

      flushSync(() =>
        request.respond(
          200,
          '{"url":"https://cdn.example.com/committed.txt","id":"committed"}',
        )
      );
      assertEquals(
        (committed as unknown as UseUploadResult).attachments[0]?.url,
        "https://cdn.example.com/committed.txt",
      );

      flushSync(() =>
        root.render(
          <React.Suspense fallback={null}>
            <Capture url="/committed" />
          </React.Suspense>,
        )
      );
      await unmount(root);
    } finally {
      dom.restore();
    }
  });
});
