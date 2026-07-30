import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  cloneServerDataContext,
  cloneStaticDataContext,
  isDataControlResult,
  notFound,
  redirect,
  snapshotDataParams,
  validateDataResult,
} from "./helpers.ts";
import type { DataContext } from "./types.ts";
import {
  MAX_DATA_PARAM_ARRAY_SEGMENTS,
  MAX_DATA_PARAM_KEY_CHARACTERS,
  MAX_DATA_PARAM_PROPERTIES,
  MAX_DATA_PARAM_VALUE_CHARACTERS,
  MAX_DATA_QUERY_CHARACTERS,
  MAX_DATA_URL_CHARACTERS,
} from "./data-limits.ts";

describe("helpers.ts", () => {
  describe("redirect", () => {
    it("should create a redirect result with destination", () => {
      const result = redirect("/login");

      assertEquals(result.redirect?.destination, "/login");
      assertEquals(result.redirect?.permanent, false);
    });

    it("should default to temporary redirect (permanent: false)", () => {
      const result = redirect("/dashboard");

      assertEquals(result.redirect?.permanent, false);
    });

    it("should support permanent redirect", () => {
      const result = redirect("/new-page", true);

      assertEquals(result.redirect?.destination, "/new-page");
      assertEquals(result.redirect?.permanent, true);
    });

    it("should support explicit temporary redirect", () => {
      const result = redirect("/temp-page", false);

      assertEquals(result.redirect?.permanent, false);
    });

    it("should handle absolute URLs", () => {
      const result = redirect("https://example.com/external");

      assertEquals(result.redirect?.destination, "https://example.com/external");
    });

    it("should handle URLs with query parameters", () => {
      const result = redirect("/search?q=test&page=1");

      assertEquals(result.redirect?.destination, "/search?q=test&page=1");
    });

    it("should handle URLs with hash fragments", () => {
      const result = redirect("/docs#getting-started");

      assertEquals(result.redirect?.destination, "/docs#getting-started");
    });

    it("should not set props or notFound", () => {
      const result = redirect("/somewhere");

      assertEquals(result.props, undefined);
      assertEquals(result.notFound, undefined);
    });
  });

  describe("notFound", () => {
    it("should create a notFound result", () => {
      const result = notFound();

      assertEquals(result.notFound, true);
    });

    it("should not set props or redirect", () => {
      const result = notFound();

      assertEquals(result.props, undefined);
      assertEquals(result.redirect, undefined);
    });

    it("should return consistent result on multiple calls", () => {
      const result1 = notFound();
      const result2 = notFound();

      assertEquals(result1.notFound, result2.notFound);
    });
  });

  describe("isDataControlResult", () => {
    it("recognises a thrown notFound()", () => {
      assertEquals(isDataControlResult(notFound()), true);
    });

    it("recognises a thrown redirect()", () => {
      assertEquals(isDataControlResult(redirect("/login")), true);
      assertEquals(isDataControlResult(redirect("/login", true)), true);
    });

    it("does not treat an Error as a control result", () => {
      // A real failure must keep flowing to the error handler.
      assertEquals(isDataControlResult(new Error("boom")), false);
      const tagged = new Error("boom") as Error & { notFound?: boolean };
      tagged.notFound = true;
      assertEquals(isDataControlResult(tagged), false);
    });

    it("rejects primitives and null", () => {
      assertEquals(isDataControlResult(null), false);
      assertEquals(isDataControlResult(undefined), false);
      assertEquals(isDataControlResult("notFound"), false);
      assertEquals(isDataControlResult(404), false);
    });

    it("rejects Proxy control candidates without executing traps", () => {
      let reads = 0;
      const proxy = new Proxy(notFound(), {
        get(target, key, receiver) {
          reads++;
          return Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor(target, key) {
          reads++;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });

      assertEquals(isDataControlResult(proxy), false);
      assertEquals(reads, 0);
    });

    it("rejects a props-only result", () => {
      assertEquals(isDataControlResult({ props: { a: 1 } }), false);
    });

    it("rejects a malformed redirect", () => {
      assertEquals(isDataControlResult({ redirect: {} }), false);
      assertEquals(isDataControlResult({ redirect: { destination: 42 } }), false);
    });

    it("rejects notFound: false", () => {
      assertEquals(isDataControlResult({ notFound: false }), false);
    });

    // A loader that does `throw await res.json()` against an upstream returning
    // `{ notFound: true, message: "record locked" }` must reach the error
    // handler. Reading it as a 404 renders the wrong page, records a circuit
    // breaker success, skips the log, and caches the bogus 404.
    it("rejects an unbranded object that only looks like notFound()", () => {
      assertEquals(isDataControlResult({ notFound: true }), false);
      assertEquals(
        isDataControlResult({ notFound: true, message: "record locked", requestId: "abc" }),
        false,
      );
    });

    it("rejects an unbranded object that only looks like redirect()", () => {
      assertEquals(isDataControlResult({ redirect: { destination: "/login" } }), false);
      assertEquals(
        isDataControlResult({ redirect: { destination: "/login", permanent: true } }),
        false,
      );
    });

    it("recognises a control result rebuilt from the same public brand", () => {
      // Project code runs against its own copy of the helpers. The brand is a
      // registered symbol so it matches across module instances and realms.
      const rebuilt = { notFound: true };
      Object.defineProperty(rebuilt, Symbol.for("veryfront.dataControlResult"), { value: true });

      assertEquals(isDataControlResult(rebuilt), true);
    });
  });

  describe("returned-result contract", () => {
    it("keeps the brand off the serialized shape", () => {
      assertEquals(JSON.stringify(notFound()), '{"notFound":true}');
      assertEquals(
        JSON.stringify(redirect("/login")),
        '{"redirect":{"destination":"/login","permanent":false}}',
      );
    });

    it("keeps the brand off enumerable keys", () => {
      assertEquals(Object.keys(notFound()), ["notFound"]);
      assertEquals(Object.keys(redirect("/login")), ["redirect"]);
    });

    it("rejects multiple active outcomes", () => {
      for (
        const value of [
          {
            props: { id: 1 },
            redirect: { destination: "/other" },
          },
          { props: { id: 1 }, notFound: true },
          {
            redirect: { destination: "/other" },
            notFound: true,
          },
        ]
      ) {
        assertThrows(
          () => validateDataResult(value, "getStaticData"),
          TypeError,
          "valid data result object",
        );
      }
    });

    it("rejects negative revalidation intervals", () => {
      assertThrows(
        () =>
          validateDataResult(
            { props: {}, revalidate: -1 },
            "getStaticData",
          ),
        TypeError,
        "valid data result object",
      );
    });

    it("preserves compatible empty and inactive-control results", () => {
      const empty = {};
      const props = { props: { ok: true }, notFound: false };

      assertEquals(validateDataResult(empty, "getServerData"), empty);
      assertEquals(validateDataResult(props, "getServerData"), props);
    });

    it("snapshots accessor-backed outcomes exactly once", () => {
      let notFoundReads = 0;
      const unstable = {
        redirect: { destination: "/stable" },
        get notFound(): boolean {
          notFoundReads++;
          return notFoundReads > 1;
        },
      };

      const normalized = validateDataResult(
        unstable,
        "getStaticData",
      );

      assertEquals(notFoundReads, 1);
      assertEquals(normalized, {
        redirect: { destination: "/stable" },
        notFound: false,
      });
      assertEquals(unstable.notFound, true);
      assertEquals(normalized.notFound, false);
    });
  });

  describe("data context snapshots", () => {
    it("copies exact own string and dense string-array params", () => {
      const source = Object.create(null) as Record<string, string | string[]>;
      Object.defineProperty(source, "__proto__", {
        enumerable: true,
        value: "safe",
      });
      source.slug = ["docs", "install"];

      const snapshot = snapshotDataParams(source);

      assertEquals(Object.hasOwn(snapshot, "__proto__"), true);
      assertEquals(snapshot.__proto__, "safe");
      assertEquals(snapshot.slug, ["docs", "install"]);
      assertEquals(Object.getPrototypeOf(snapshot), Object.prototype);
      assertEquals(snapshot.slug === source.slug, false);
    });

    it("rejects cache-aliasing and executable param representations", () => {
      const sparse = new Array<string>(2);
      sparse[1] = "second";
      const inherited = Object.create({ inherited: "value" }) as Record<string, string>;
      inherited.own = "value";
      let accessorReads = 0;
      const accessor = Object.defineProperty({}, "slug", {
        enumerable: true,
        get() {
          accessorReads++;
          return "hidden";
        },
      });

      for (
        const params of [
          { id: null },
          { id: Number.NaN },
          { id: {} },
          { slug: sparse },
          inherited,
          accessor,
        ]
      ) {
        assertThrows(
          () => snapshotDataParams(params),
          TypeError,
          "plain record of string or dense string-array data properties",
        );
      }
      assertEquals(accessorReads, 0);
    });

    it("bounds direct parameter, URL, and query inputs", () => {
      const tooManyParams: Record<string, string> = {};
      for (let index = 0; index <= MAX_DATA_PARAM_PROPERTIES; index++) {
        tooManyParams[`key-${index}`] = "value";
      }
      for (
        const params of [
          tooManyParams,
          { ["k".repeat(MAX_DATA_PARAM_KEY_CHARACTERS + 1)]: "value" },
          { value: "x".repeat(MAX_DATA_PARAM_VALUE_CHARACTERS + 1) },
          {
            catchAll: Array.from(
              { length: MAX_DATA_PARAM_ARRAY_SEGMENTS + 1 },
              () => "segment",
            ),
          },
        ]
      ) {
        assertThrows(() => snapshotDataParams(params), RangeError, "limit");
      }

      const longUrl = new URL(
        `https://example.test/${"u".repeat(MAX_DATA_URL_CHARACTERS)}`,
      );
      assertThrows(
        () =>
          cloneStaticDataContext({
            params: {},
            url: longUrl,
          }),
        RangeError,
        "URL must not exceed",
      );

      const request = new Request("https://example.test/query");
      assertThrows(
        () =>
          cloneServerDataContext({
            params: {},
            query: new URLSearchParams(
              `value=${"q".repeat(MAX_DATA_QUERY_CHARACTERS)}`,
            ),
            request,
            url: new URL(request.url),
          }),
        RangeError,
        "query must not exceed",
      );
    });

    it("clones static identity without reading request-only fields", () => {
      let requestReads = 0;
      let queryReads = 0;
      const context = Object.defineProperties({}, {
        params: { enumerable: true, value: { slug: "page" } },
        url: { enumerable: true, value: new URL("https://example.test/page") },
        request: {
          enumerable: true,
          get() {
            requestReads++;
            throw new Error("request must remain unread");
          },
        },
        query: {
          enumerable: true,
          get() {
            queryReads++;
            throw new Error("query must remain unread");
          },
        },
      });

      assertEquals(
        cloneStaticDataContext(
          context as Pick<DataContext, "params" | "url">,
        ),
        {
          params: { slug: "page" },
          url: new URL("https://example.test/page"),
        },
      );
      assertEquals({ requestReads, queryReads }, { requestReads: 0, queryReads: 0 });
    });

    it("clones a Request through the intrinsic operation", () => {
      const request = new Request("https://example.test/intrinsic-clone");
      let cloneReads = 0;
      Object.defineProperty(request, "clone", {
        configurable: true,
        get() {
          cloneReads++;
          throw new Error("an own clone field must not be consulted");
        },
      });

      const cloned = cloneServerDataContext(
        {
          params: {},
          query: new URLSearchParams(),
          request,
          url: new URL(request.url),
        },
        { cloneRequest: true },
      );

      assertEquals(cloneReads, 0);
      assertEquals(cloned.request === request, false);
      assertEquals(cloned.request.url, "https://example.test/intrinsic-clone");
    });
  });
});
