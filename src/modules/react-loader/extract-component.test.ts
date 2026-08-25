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

  it("keeps a memo component that is declared before a helper function", () => {
    const Page = { $$typeof: Symbol.for("react.memo"), type: () => null };
    const loader = () => null;
    assertEquals(
      extractComponent({ __esModule: true, Page, loader }, "memo-page.tsx"),
      Page,
      "a React-tagged object and a function are both components, so declaration order decides",
    );
  });

  it("does not mistake a React element for a component type", () => {
    const Header = { $$typeof: Symbol.for("react.transitional.element"), type: "div" };
    const Page = () => null;
    assertEquals(
      extractComponent({ __esModule: true, Header, Page }, "element-export.tsx"),
      Page,
      "an element is a rendered node, not something React can instantiate as a component",
    );
  });

  it("falls back to an untagged object when no function or tagged component exists", () => {
    const Odd = { render: () => null };
    assertEquals(
      extractComponent({ __esModule: true, Odd }, "odd.tsx"),
      Odd,
      "an unrecognised component shape is still preferred over exporting nothing",
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

  it("keeps a context provider declared before a helper function", () => {
    const Ctx = { $$typeof: Symbol.for("react.context"), Provider: () => null };
    const helper = () => null;
    assertEquals(
      extractComponent({ __esModule: true, Ctx, helper }, "context.tsx"),
      Ctx,
      "a context is a renderable React type, so declaration order decides against a helper",
    );
  });

  it("keeps a provider type declared before a helper function", () => {
    const Provider = { $$typeof: Symbol.for("react.provider"), _context: {} };
    const helper = () => null;
    assertEquals(
      extractComponent({ __esModule: true, Provider, helper }, "provider.tsx"),
      Provider,
      "a provider is a renderable React type, so declaration order decides against a helper",
    );
  });

  it("keeps a consumer type declared before a helper function", () => {
    const Consumer = { $$typeof: Symbol.for("react.consumer"), _context: {} };
    const helper = () => null;
    assertEquals(
      extractComponent({ __esModule: true, Consumer, helper }, "consumer.tsx"),
      Consumer,
      "a consumer is a renderable React type, so declaration order decides against a helper",
    );
  });

  it("skips an export that throws when it is read", () => {
    const Page = () => null;
    const moduleObj: Record<string, unknown> = { __esModule: true };
    Object.defineProperty(moduleObj, "circular", {
      enumerable: true,
      get() {
        throw new ReferenceError("Cannot access 'circular' before initialization");
      },
    });
    moduleObj.Page = Page;

    assertEquals(
      extractComponent(moduleObj, "circular.tsx"),
      Page,
      "a namespace getter that throws must not hide a usable component behind it",
    );
  });

  it("does not read a later getter after finding a component", () => {
    const Page = () => null;
    const moduleObj: Record<string, unknown> = { __esModule: true, Page };
    Object.defineProperty(moduleObj, "optionalDependency", {
      enumerable: true,
      get() {
        throw new ReferenceError("Cannot access 'optionalDependency' before initialization");
      },
    });

    assertEquals(
      extractComponent(moduleObj, "lazy.tsx"),
      Page,
      "an unrelated getter after the selected component must never be evaluated",
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
