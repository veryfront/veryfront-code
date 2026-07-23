import "#veryfront/schemas/_test-setup.ts";
import * as React from "react";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  getBaseLogger,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import {
  type RequestContext,
  runWithRequestContextAsync,
} from "#veryfront/utils/logger/request-context.ts";
import {
  __injectReactDOMServerForTests,
  type ReactDOMServer,
  resetReactCache,
} from "./server-loader.ts";
import { renderToStaticMarkupAdapter, renderToStringAdapter } from "./string-renderer.ts";

function createPrivateError(): Error {
  const error = new Error("private-render-message-canary");
  error.name = "PrivateErrorNameCanary";
  error.stack = "Error: private-render-message-canary\n  at /private/source/path-canary.tsx:1:1";
  return error;
}

function createServer(overrides: Partial<ReactDOMServer>): ReactDOMServer {
  return {
    renderToString: () => "<p>string</p>",
    renderToStaticMarkup: () => "<p>static</p>",
    ...overrides,
  };
}

describe("react/compat/ssr-adapter/string-renderer", () => {
  afterEach(() => {
    __injectReactDOMServerForTests(null);
    resetReactCache();
    __resetLogRecordEmitterForTests();
  });

  it("logs bounded metadata without raw render errors or request identity", async () => {
    const privateError = createPrivateError();
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    __injectReactDOMServerForTests(createServer({
      renderToString: () => {
        throw privateError;
      },
      renderToStaticMarkup: () => {
        throw privateError;
      },
    }));
    const requestContext: RequestContext = {
      logger: getBaseLogger("SERVER").child({
        project_id: "private-project-canary",
        request_id: "private-request-canary",
      }),
      projectId: "private-project-canary",
      projectSlug: "private-project-slug-canary",
      requestId: "private-request-canary",
    };

    await runWithRequestContextAsync(requestContext, async () => {
      await assertRejects(
        () => renderToStringAdapter(React.createElement("p")),
        Error,
        "private-render-message-canary",
      );
      await assertRejects(
        () => renderToStaticMarkupAdapter(React.createElement("p")),
        Error,
        "private-render-message-canary",
      );
    });

    const failures = entries.filter((entry) =>
      entry.message === "SSR renderToString failed" ||
      entry.message === "SSR renderToStaticMarkup failed"
    );
    assertEquals(failures.length, 2);
    for (const failure of failures) {
      assertEquals(failure.context, { errorCategory: "error" });
      assertEquals(failure.error, undefined);
      for (
        const privateValue of [
          "private-render-message-canary",
          "PrivateErrorNameCanary",
          "private/source/path-canary",
          "private-project-canary",
          "private-project-slug-canary",
          "private-request-canary",
        ]
      ) {
        assertEquals(JSON.stringify(failure).includes(privateValue), false);
      }
    }
  });

  it("sanitizes readable stream error and fallback logs", async () => {
    const privateError = createPrivateError();
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    __injectReactDOMServerForTests(createServer({
      renderToReadableStream: (_element, options) => {
        options?.onError?.(privateError, { componentStack: "" });
        return Promise.reject(privateError);
      },
      renderToString: () => "<p>safe fallback</p>",
    }));

    const html = await renderToStringAdapter(React.createElement("p"));

    assertEquals(html, "<p>safe fallback</p>");
    const failures = entries.filter((entry) =>
      entry.message === "SSR renderToReadableStream error" ||
      entry.message === "SSR renderToReadableStream failed, falling back to renderToString"
    );
    assertEquals(failures.length, 2);
    for (const failure of failures) {
      assertEquals(failure.context, { errorCategory: "error" });
      assertEquals(failure.error, undefined);
      assertEquals(JSON.stringify(failure).includes("private-render-message-canary"), false);
      assertEquals(JSON.stringify(failure).includes("PrivateErrorNameCanary"), false);
      assertEquals(JSON.stringify(failure).includes("private/source/path-canary"), false);
    }
  });
});
