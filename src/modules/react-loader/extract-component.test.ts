import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractComponent } from "./extract-component.ts";

describe("modules/react-loader/extract-component", () => {
  it("should extract default export", () => {
    const MyComponent = () => null;
    assertEquals(extractComponent({ default: MyComponent }, "test.tsx"), MyComponent);
  });

  it("should fallback to first named export if no default", () => {
    const First = () => null;
    const Second = () => null;
    assertEquals(
      extractComponent({ First, Second }, "test.tsx"),
      First,
      "the first named export must win when there is no default export",
    );
  });

  it("should prefer default over named exports", () => {
    const Default = () => null;
    const Named = () => null;
    assertEquals(extractComponent({ default: Default, Named }, "test.tsx"), Default);
  });

  it("should throw when module has no exports", () => {
    assertThrows(
      () => extractComponent({}, "empty.tsx"),
      Error,
      "No component exported from empty.tsx",
    );
  });

  it("skips the __esModule marker when falling back to a named export", () => {
    const Named = () => null;
    assertEquals(
      extractComponent({ __esModule: true, Named }, "cjs.tsx"),
      Named,
      "a transpiled CommonJS namespace must yield its component, not the __esModule boolean",
    );
  });

  it("throws when the only export is the __esModule marker", () => {
    assertThrows(
      () => extractComponent({ __esModule: true }, "marker-only.tsx"),
      Error,
      "No component exported from marker-only.tsx",
      "a namespace carrying only the transpiler marker exports no component",
    );
  });

  it("skips named exports that cannot be rendered", () => {
    const Named = () => null;
    assertEquals(
      extractComponent({ version: "1.0.0", count: 2, Named }, "meta.tsx"),
      Named,
      "primitive exports declared ahead of the component must not be mistaken for it",
    );
  });

  it("prefers a function export over a data export such as App Router metadata", () => {
    const Page = () => null;
    assertEquals(
      extractComponent({ __esModule: true, metadata: { title: "Home" }, Page }, "page.tsx"),
      Page,
      "a data object exported ahead of the component must not be mistaken for it",
    );
  });

  it("accepts object components such as memo and forwardRef results", () => {
    const Memoized = { $$typeof: Symbol.for("react.memo"), type: () => null };
    assertEquals(
      extractComponent({ __esModule: true, Memoized }, "memo.tsx"),
      Memoized,
      "React.memo and React.forwardRef produce objects, which are valid components",
    );
  });

  it("hands back a default export that is not renderable", () => {
    assertEquals(
      extractComponent({ __esModule: true, default: 42 }, "bad-default.tsx") as unknown,
      42,
      "callers validate the default themselves so they can name the slot that is wrong, such as a layout",
    );
  });
});
