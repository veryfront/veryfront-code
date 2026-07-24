import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertNotStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { toHTMLFrontmatter, toMDXFrontmatter } from "./frontmatter.ts";

describe("toMDXFrontmatter", () => {
  it("preserves YAML-shaped fields while snapshotting mutable values", () => {
    const tags = ["engineering", "release"];
    const date = new Date("2026-07-24T08:30:00.000Z");
    const result = toMDXFrontmatter({
      title: "Production notes",
      tags,
      date,
      published: true,
      priority: 4,
      custom: "retained",
    });

    assertEquals(result, {
      title: "Production notes",
      tags: ["engineering", "release"],
      date: new Date("2026-07-24T08:30:00.000Z"),
      published: true,
      priority: 4,
      custom: "retained",
    });
    assertNotStrictEquals(result.tags, tags);
    assertNotStrictEquals(result.date, date);

    tags[0] = "mutated";
    assertEquals(result.tags, ["engineering", "release"]);
  });

  it("preserves the legacy scalar tag contract", () => {
    assertEquals(toMDXFrontmatter({ tags: "release" }), { tags: "release" });
  });

  it("preserves nested serializable frontmatter without sharing source state", () => {
    const source = {
      metadata: {
        author: "John Doe",
        publishedAt: new Date("2024-01-01T00:00:00.000Z"),
        flags: [true, null, 3],
      },
    };

    const result = toMDXFrontmatter(source);

    assertEquals(result, {
      metadata: {
        author: "John Doe",
        publishedAt: new Date("2024-01-01T00:00:00.000Z"),
        flags: [true, null, 3],
      },
    });
    assertEquals((result.metadata as unknown) === source.metadata, false);
    assertEquals(
      (result.metadata as unknown as { flags: unknown[] }).flags === source.metadata.flags,
      false,
    );
  });

  it("omits cyclic and accessor-backed nested values", () => {
    let getterCalls = 0;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const nested: Record<string, unknown> = { safe: "value", cyclic };
    Object.defineProperty(nested, "unsafe", {
      enumerable: true,
      get() {
        getterCalls++;
        return "getter value";
      },
    });

    assertEquals(toMDXFrontmatter({ nested }), {
      nested: { safe: "value" },
    });
    assertEquals(getterCalls, 0);
  });

  it("retains only own enumerable frontmatter data properties", () => {
    let getterCalls = 0;
    const source = Object.create({ inherited: "drop me" }) as Record<string, unknown>;

    Object.defineProperties(source, {
      safeString: { enumerable: true, value: "value" },
      safeNumber: { enumerable: true, value: 3 },
      safeBoolean: { enumerable: true, value: false },
      safeArray: { enumerable: true, value: ["one", "two"] },
      nested: { enumerable: true, value: { unsafe: true } },
      mixed: { enumerable: true, value: ["one", 2] },
      nullable: { enumerable: true, value: null },
      infinite: { enumerable: true, value: Number.POSITIVE_INFINITY },
      hidden: { enumerable: false, value: "drop me" },
      accessor: {
        enumerable: true,
        get() {
          getterCalls++;
          return "drop me";
        },
      },
    });

    const result = toMDXFrontmatter(source);

    assertEquals(result, {
      safeString: "value",
      safeNumber: 3,
      safeBoolean: false,
      safeArray: ["one", "two"],
      nested: { unsafe: true },
      mixed: ["one", 2],
      nullable: null,
    });
    assertEquals(getterCalls, 0);
  });

  it("rejects accessor-backed and sparse arrays while preserving mixed YAML arrays", () => {
    let getterCalls = 0;
    const accessorArray = ["placeholder"];
    Object.defineProperty(accessorArray, "0", {
      enumerable: true,
      get() {
        getterCalls++;
        return "unsafe";
      },
    });

    const sparseArray = new Array<string>(2);
    sparseArray[1] = "second";

    assertEquals(
      toMDXFrontmatter({
        accessorArray,
        sparseArray,
        mixedArray: ["valid", 1],
      }),
      { mixedArray: ["valid", 1] },
    );
    assertEquals(getterCalls, 0);
  });

  it("defines __proto__ as data without changing the result prototype", () => {
    const source: Record<string, unknown> = {};
    Object.defineProperty(source, "__proto__", {
      enumerable: true,
      value: "safe-data",
    });

    const result = toMDXFrontmatter(source);

    assert(Object.hasOwn(result, "__proto__"));
    assertEquals(result.__proto__, "safe-data");
    assertEquals(Object.getPrototypeOf(result), Object.prototype);
  });

  it("fails closed when an input cannot be inspected", () => {
    const unreadable = new Proxy({}, {
      ownKeys() {
        throw new Error("unreadable");
      },
    });

    assertEquals(toMDXFrontmatter(unreadable), {});
  });
});

describe("toHTMLFrontmatter", () => {
  it("snapshots every supported structured metadata field", () => {
    const result = toHTMLFrontmatter({
      title: "Structured metadata",
      headings: [{ text: "Introduction", level: 2 }],
      metadata: {
        description: "Nested metadata",
        og: { locale: "en_US" },
      },
      og: { title: "OpenGraph title", imageWidth: 1200 },
      twitter: { card: "summary_large_image", enabled: true },
      meta: [{ name: "robots", content: "index,follow" }],
      links: [{ rel: "canonical", href: "https://example.com", hreflang: "en" }],
      icons: [{ href: "/icon.svg", type: "image/svg+xml" }],
      scripts: [{ src: "/client.js", defer: "true" }],
      styles: [{ href: "/site.css", media: "screen" }],
      viewport: "width=device-width",
      themeColor: "#ffffff",
    });

    assertEquals(result, {
      title: "Structured metadata",
      headings: [{ text: "Introduction", level: 2 }],
      metadata: {
        description: "Nested metadata",
        og: { locale: "en_US" },
      },
      og: { title: "OpenGraph title", imageWidth: 1200 },
      twitter: { card: "summary_large_image", enabled: true },
      meta: [{ name: "robots", content: "index,follow" }],
      links: [{ rel: "canonical", href: "https://example.com", hreflang: "en" }],
      icons: [{ href: "/icon.svg", type: "image/svg+xml" }],
      scripts: [{ src: "/client.js", defer: "true" }],
      styles: [{ href: "/site.css", media: "screen" }],
      viewport: "width=device-width",
      themeColor: "#ffffff",
    });
  });

  it("filters known structured fields while retaining safe custom data", () => {
    let getterCalls = 0;
    const hostile = Object.create({ inherited: "drop" }) as Record<string, unknown>;
    Object.defineProperties(hostile, {
      og: {
        enumerable: true,
        value: {
          title: "safe",
          get description() {
            getterCalls++;
            return "unsafe";
          },
        },
      },
      links: {
        enumerable: true,
        value: [{ rel: "canonical", href: { nested: true } }],
      },
      scripts: {
        enumerable: true,
        value: [{ src: "/safe.js", config: { nested: true } }],
      },
      customNested: {
        enumerable: true,
        value: { unsafe: true },
      },
    });

    assertEquals(toHTMLFrontmatter(hostile), {
      og: { title: "safe" },
      scripts: [{ src: "/safe.js" }],
      customNested: { unsafe: true },
    });
    assertEquals(getterCalls, 0);
  });

  it("bounds repeated inspection of invalid shared branches", () => {
    let descriptorInspections = 0;
    const sharedInvalid = new Proxy(
      [...Array.from({ length: 99 }, () => "safe"), () => "unsupported"],
      {
        getOwnPropertyDescriptor(target, key) {
          descriptorInspections++;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    const source = Object.fromEntries(
      Array.from({ length: 600 }, (_, index) => [`branch${index}`, sharedInvalid]),
    );

    assertEquals(toMDXFrontmatter(source), {});
    assert(
      descriptorInspections <= 50_500,
      `expected a bounded inspection count, received ${descriptorInspections}`,
    );
  });
});
