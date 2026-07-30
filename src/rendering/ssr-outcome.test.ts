import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { notFound, redirect } from "#veryfront/data/helpers.ts";
import {
  API_CLIENT_ERROR,
  FILE_NOT_FOUND,
  RENDER_ERROR,
  SERVICE_OVERLOADED,
} from "#veryfront/errors";
import { findSSRControlOutcome, isSSRControlOutcome, resolveSSRFailure } from "./ssr-outcome.ts";

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
          want: { kind: "not-found" },
        },
        {
          name: "undeployed release file list",
          error: API_CLIENT_ERROR.create({
            detail: "missing files",
            status: 404,
            context: {
              details: { url: "/api/projects/p1/environments/production/files" },
            },
          }),
          context: { isLocalProject: false },
          want: { kind: "undeployed" },
        },
        {
          name: "render redirect context",
          error: redirectError,
          context: { isLocalProject: false },
          want: { kind: "redirect", location: "/login", permanent: true },
        },
        {
          name: "service overloaded",
          error: overloaded,
          context: { isLocalProject: true },
          want: { kind: "overloaded", status: 429 },
        },
        {
          name: "generic local runtime",
          error: genericLocal,
          context: { isLocalProject: true },
          want: { kind: "runtime", exposure: "development-overlay" },
        },
        {
          name: "generic production server error",
          error: genericProduction,
          context: { isLocalProject: false },
          want: { kind: "server-error", exposure: "generic" },
        },
        {
          name: "app-router error boundary",
          error: boundaryError,
          context: { isLocalProject: true },
          want: {
            kind: "app-router-error-boundary",
            html: "<!doctype html><html><body>boundary</body></html>",
          },
        },
      ] as const;

      for (const testCase of cases) {
        const outcome = resolveSSRFailure(testCase.error, testCase.context);
        assertEquals(outcome.kind, testCase.want.kind, testCase.name);

        switch (testCase.want.kind) {
          case "not-found":
          case "undeployed":
            break;
          case "redirect":
            assertEquals(outcome, testCase.want, testCase.name);
            break;
          case "overloaded":
            assertEquals(outcome.status, testCase.want.status, testCase.name);
            assertStrictEquals(outcome.error, overloaded, testCase.name);
            break;
          case "runtime":
          case "server-error":
            assertEquals(outcome.exposure, testCase.want.exposure, testCase.name);
            assertStrictEquals(outcome.error, testCase.error, testCase.name);
            break;
          case "app-router-error-boundary":
            assertEquals(outcome.html, testCase.want.html, testCase.name);
            assertStrictEquals(outcome.error, boundaryError, testCase.name);
            break;
        }
      }
    });

    it("defaults service-overloaded to 503 when the error has no status", () => {
      const overloaded = SERVICE_OVERLOADED.create({ detail: "queue is full" });
      Object.assign(overloaded, { status: undefined });

      const outcome = resolveSSRFailure(overloaded, { isLocalProject: true });

      assertEquals(outcome.kind, "overloaded");
      assertEquals(outcome.status, 503);
      assertStrictEquals(outcome.error, overloaded);
    });
  });
});
