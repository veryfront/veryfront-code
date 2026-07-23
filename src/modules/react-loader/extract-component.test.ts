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
    const Named = () => null;
    assertEquals(extractComponent({ Named }, "test.tsx"), Named);
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

  it("skips non-component exports when selecting a named export", () => {
    const Named = () => null;
    assertEquals(extractComponent({ count: 1, Named }, "test.tsx"), Named);
  });

  it("rejects truthy values that are not React components", () => {
    assertThrows(
      () => extractComponent({ default: { value: true }, count: 1 }, "invalid.tsx"),
      Error,
      "No component exported from invalid.tsx",
    );
  });

  it("accepts React wrapper component types", () => {
    const MemoLike = { $$typeof: Symbol.for("react.memo") };
    assertEquals(extractComponent({ default: MemoLike }, "memo.tsx"), MemoLike);
  });

  it("does not expose an absolute path in export errors", () => {
    assertThrows(
      () => extractComponent({}, "/private/project/components/empty.tsx"),
      Error,
      "No component exported from empty.tsx",
    );
  });
});
