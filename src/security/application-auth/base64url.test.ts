import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { decodeAuthBase64Url, encodeAuthBase64Url } from "./base64url.ts";

const TestObjectDefineProperty = Object.defineProperty;
const TestObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const TestReflectApply = Reflect.apply;
const TestRegExpPrototypeExec = RegExp.prototype.exec;
const TestStringPrototypeIndexOf = String.prototype.indexOf;

function replacePropertyForTest(target: object, key: PropertyKey, value: unknown): () => void {
  const descriptor = TestReflectApply(
    TestObjectGetOwnPropertyDescriptor,
    Object,
    [target, key],
  ) as PropertyDescriptor | undefined;
  if (descriptor === undefined) throw new Error(`Expected ${String(key)} descriptor`);
  TestReflectApply(TestObjectDefineProperty, Object, [target, key, { ...descriptor, value }]);
  return () => {
    TestReflectApply(TestObjectDefineProperty, Object, [target, key, descriptor]);
  };
}

describe("security/application-auth base64url", () => {
  it("decodes the original bytes after regexp matching is poisoned", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    const encoded = encodeAuthBase64Url(bytes);
    const restoreTest = replacePropertyForTest(RegExp.prototype, "test", () => false);
    const restoreExec = replacePropertyForTest(
      RegExp.prototype,
      "exec",
      function (this: RegExp, value: string): RegExpExecArray | null {
        if (value === encoded) return null;
        return TestReflectApply(TestRegExpPrototypeExec, this, [value]) as RegExpExecArray | null;
      },
    );

    try {
      assertEquals(decodeAuthBase64Url(encoded), bytes);
    } finally {
      restoreExec();
      restoreTest();
    }
  });

  it("decodes the original bytes after string lookup is poisoned", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    const encoded = encodeAuthBase64Url(bytes);
    const restore = replacePropertyForTest(
      String.prototype,
      "indexOf",
      function (this: string, search: string, position?: number): number {
        if (this === "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_") return -1;
        return TestReflectApply(TestStringPrototypeIndexOf, this, [search, position]) as number;
      },
    );

    try {
      assertEquals(decodeAuthBase64Url(encoded), bytes);
    } finally {
      restore();
    }
  });
});
