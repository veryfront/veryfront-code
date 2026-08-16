import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { notFound, redirect } from "#veryfront/data/helpers.ts";
import {
  API_CLIENT_ERROR,
  BUILD_FAILED,
  FILE_NOT_FOUND,
  MODULE_NOT_FOUND,
  RENDER_ERROR,
  SERVICE_OVERLOADED,
} from "#veryfront/errors";
import type { SSRFailureOutcome } from "./ssr-outcome.ts";
import {
  findSSRControlOutcome,
  isSSRBuildFailure,
  isSSRControlOutcome,
  resolveSSRControlOutcome,
  resolveSSRFailure,
} from "./ssr-outcome.ts";
import { attachDataResponseMetadata } from "#veryfront/data/response-metadata.ts";

function assertSSRFailureOutcome(
  actual: SSRFailureOutcome,
  expected: SSRFailureOutcome,
  message?: string,
): void {
  switch (expected.kind) {
    case "not-found":
      assertEquals(actual, expected, message);
      return;
    case "redirect":
      assertEquals(actual, expected, message);
      return;
    case "app-router-error-boundary":
      if (actual.kind !== "app-router-error-boundary") {
        assertEquals(actual.kind, expected.kind, message);
        return;
      }
      assertEquals(actual.html, expected.html, message);
      assertStrictEquals(actual.error, expected.error, message);
      return;
    case "undeployed":
      if (actual.kind !== "undeployed") {
        assertEquals(actual.kind, expected.kind, message);
        return;
      }
      assertStrictEquals(actual.error, expected.error, message);
      return;
    case "overloaded":
      if (actual.kind !== "overloaded") {
        assertEquals(actual.kind, expected.kind, message);
        return;
      }
      assertEquals(actual.status, expected.status, message);
      assertStrictEquals(actual.error, expected.error, message);
      return;
    case "runtime":
      if (actual.kind !== "runtime") {
        assertEquals(actual.kind, expected.kind, message);
        return;
      }
      assertEquals(actual.exposure, expected.exposure, message);
      assertStrictEquals(actual.error, expected.error, message);
      return;
    case "server-error":
      if (actual.kind !== "server-error") {
        assertEquals(actual.kind, expected.kind, message);
        return;
      }
      assertEquals(actual.exposure, expected.exposure, message);
      assertStrictEquals(actual.error, expected.error, message);
      return;
  }
}

describe("ssr-outcome.ts", () => {
  describe("findSSRControlOutcome", () => {
    it("finds a branded redirect through cause and AggregateError nodes", () => {
      const wrapped = new AggregateError([
        new Error("other"),
        new Error("wrapped", { cause: redirect("/login", true) }),
      ]);

      assertEquals(findSSRControlOutcome(wrapped), {
        kind: "redirect",
        location: "/login",
        permanent: true,
      });
    });

    it("rejects an unbranded redirect-shaped value", () => {
      assertEquals(
        findSSRControlOutcome({
          redirect: { destination: "/login", permanent: false },
        }),
        null,
      );
    });

    it("terminates on cyclic error graphs", () => {
      const cyclic: { cause?: unknown } = {};
      cyclic.cause = cyclic;

      assertEquals(findSSRControlOutcome(cyclic), null);
    });

    it("normalizes a branded notFound result", () => {
      assertEquals(findSSRControlOutcome(notFound()), { kind: "not-found" });
    });
  });

  describe("isSSRControlOutcome", () => {
    it("returns true only when the graph contains a branded control result", () => {
      assertEquals(isSSRControlOutcome(new Error("wrapped", { cause: notFound() })), true);
      assertEquals(isSSRControlOutcome({ notFound: true }), false);
    });
  });

  describe("resolveSSRControlOutcome", () => {
    it("recognises the routing brands the render pipeline raises", () => {
      assertEquals(
        resolveSSRControlOutcome(
          attachDataResponseMetadata(
            FILE_NOT_FOUND.create({ detail: "Page not found: x" }),
            {
              headers: { "x-missing-reason": "gone" },
              cookies: [{ name: "visited-missing", value: "1", path: "/" }],
            },
          ),
        ),
        {
          kind: "not-found",
          headers: { "x-missing-reason": "gone" },
          cookies: [{ name: "visited-missing", value: "1", path: "/" }],
        },
      );
      assertEquals(
        resolveSSRControlOutcome(
          attachDataResponseMetadata(
            RENDER_ERROR.create({
              detail: "Redirect to /login",
              context: { redirect: { destination: "/login", permanent: true } },
            }),
            {
              headers: { "x-auth-result": "signed-in" },
              cookies: [{ name: "session", value: "abc", path: "/" }],
            },
          ),
        ),
        {
          kind: "redirect",
          location: "/login",
          permanent: true,
          headers: { "x-auth-result": "signed-in" },
          cookies: [{ name: "session", value: "abc", path: "/" }],
        },
      );
      assertEquals(resolveSSRControlOutcome(notFound()), { kind: "not-found" });
      assertEquals(
        resolveSSRControlOutcome(new Error("wrapped", { cause: redirect("/login") })),
        { kind: "redirect", location: "/login", permanent: false },
      );
    });

    it("reads no routing decision out of message text or plain shape", () => {
      assertEquals(resolveSSRControlOutcome(new Error("Page not found")), null);
      assertEquals(resolveSSRControlOutcome(new Error("upstream said 404")), null);
      assertEquals(resolveSSRControlOutcome(new Error("no page matched")), null);
      assertEquals(resolveSSRControlOutcome({ notFound: true }), null);
      assertEquals(
        resolveSSRControlOutcome({ redirect: { destination: "/login" } }),
        null,
      );
    });

    it("returns null for a render-error carrying no redirect", () => {
      assertEquals(
        resolveSSRControlOutcome(RENDER_ERROR.create({ detail: "boom" })),
        null,
      );
    });
  });

  describe("isSSRBuildFailure", () => {
    it("is true for compile and module-resolution categories", () => {
      assertEquals(isSSRBuildFailure(BUILD_FAILED.create({ detail: "compile failed" })), true);
      assertEquals(
        isSSRBuildFailure(MODULE_NOT_FOUND.create({ detail: "missing import" })),
        true,
      );
    });

    it("is true for a render-error flagged at the point of load failure", () => {
      assertEquals(
        isSSRBuildFailure(
          RENDER_ERROR.create({
            detail: "Critical page module(s) failed to load",
            context: { buildFailure: true },
          }),
        ),
        true,
      );
    });

    it("is false for a module that ran and threw, and for plain errors", () => {
      // Failing to load is not evidence on its own: a module that compiled and
      // threw at module scope also fails to load, and the project's own error
      // page should present that.
      assertEquals(
        isSSRBuildFailure(
          RENDER_ERROR.create({
            detail: "Critical page module(s) failed to load",
            context: { buildFailure: false },
          }),
        ),
        false,
      );
      assertEquals(isSSRBuildFailure(new Error("intentional test error")), false);
      assertEquals(isSSRBuildFailure(undefined), false);
    });
  });

  describe("resolveSSRFailure", () => {
    it("classifies known SSR failures into semantic outcomes", () => {
      const genericLocal = new Error("local render failed");
      const genericProduction = new Error("production render failed");
      const boundaryError = Object.assign(new Error("boundary rendered"), {
        errorBoundaryHtml: "<!doctype html><html><body>boundary</body></html>",
      });
      const overloaded = SERVICE_OVERLOADED.create({
        detail: "queue is full",
        status: 429,
      });
      const undeployedError = API_CLIENT_ERROR.create({
        detail: "missing files",
        status: 404,
        context: {
          details: { url: "/api/projects/p1/environments/production/files" },
        },
      });
      const redirectError = RENDER_ERROR.create({
        detail: "redirect",
        context: {
          redirect: {
            destination: "/login",
            permanent: true,
          },
        },
      });

      const cases = [
        {
          name: "file-not-found",
          error: FILE_NOT_FOUND.create({ detail: "missing page" }),
          context: { isLocalProject: false },
          want: { kind: "not-found" } satisfies SSRFailureOutcome,
        },
        {
          name: "undeployed release file list",
          error: undeployedError,
          context: { isLocalProject: false },
          want: { kind: "undeployed", error: undeployedError } satisfies SSRFailureOutcome,
        },
        {
          name: "render redirect context",
          error: redirectError,
          context: { isLocalProject: false },
          want: {
            kind: "redirect",
            location: "/login",
            permanent: true,
          } satisfies SSRFailureOutcome,
        },
        {
          name: "service overloaded",
          error: overloaded,
          context: { isLocalProject: true },
          want: { kind: "overloaded", status: 429, error: overloaded } satisfies SSRFailureOutcome,
        },
        {
          name: "generic local runtime",
          error: genericLocal,
          context: { isLocalProject: true },
          want: {
            kind: "runtime",
            exposure: "development-overlay",
            error: genericLocal,
          } satisfies SSRFailureOutcome,
        },
        {
          name: "generic production server error",
          error: genericProduction,
          context: { isLocalProject: false },
          want: {
            kind: "server-error",
            exposure: "generic",
            error: genericProduction,
          } satisfies SSRFailureOutcome,
        },
        {
          name: "app-router error boundary",
          error: boundaryError,
          context: { isLocalProject: true },
          want: {
            kind: "app-router-error-boundary",
            html: "<!doctype html><html><body>boundary</body></html>",
            error: boundaryError,
          } satisfies SSRFailureOutcome,
        },
      ] as const;

      for (const testCase of cases) {
        assertSSRFailureOutcome(
          resolveSSRFailure(testCase.error, testCase.context),
          testCase.want,
          testCase.name,
        );
      }
    });

    it("defaults service-overloaded to 503 when the error has no status", () => {
      const overloaded = SERVICE_OVERLOADED.create({ detail: "queue is full" });
      Object.assign(overloaded, { status: undefined });

      const outcome = resolveSSRFailure(overloaded, { isLocalProject: true });

      assertSSRFailureOutcome(outcome, {
        kind: "overloaded",
        status: 503,
        error: overloaded,
      });
    });

    it("prefers app-router boundary HTML over a wrapped branded control result", () => {
      const error = Object.assign(new Error("boundary rendered", { cause: notFound() }), {
        errorBoundaryHtml: "<!doctype html><html><body>boundary wins</body></html>",
      });

      assertSSRFailureOutcome(resolveSSRFailure(error, { isLocalProject: false }), {
        kind: "app-router-error-boundary",
        html: "<!doctype html><html><body>boundary wins</body></html>",
        error,
      });
    });

    it("prefers a wrapped branded control result over VeryfrontError category handling", () => {
      const error = FILE_NOT_FOUND.create({
        detail: "missing page",
        cause: redirect("/preferred", false),
      });

      assertSSRFailureOutcome(resolveSSRFailure(error, { isLocalProject: false }), {
        kind: "redirect",
        location: "/preferred",
        permanent: false,
      });
    });

    it("prefers service overload classification over local runtime fallback", () => {
      const error = SERVICE_OVERLOADED.create({ detail: "queue is full" });

      assertSSRFailureOutcome(resolveSSRFailure(error, { isLocalProject: true }), {
        kind: "overloaded",
        status: 503,
        error,
      });
    });
  });
});
