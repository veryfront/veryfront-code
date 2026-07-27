import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { FileSystemAdapter } from "./base.ts";
import {
  isNativeFileSystemAdapter,
  markNativeFileSystemAdapter,
} from "./native-file-system-provenance.ts";

Deno.test("native filesystem provenance is not spoofed by patched WeakSet intrinsics", () => {
  const unmarked = {} as FileSystemAdapter;
  const marked = {} as FileSystemAdapter;
  const originalAdd = WeakSet.prototype.add;
  const originalHas = WeakSet.prototype.has;
  const originalReflectApply = Reflect.apply;

  assertEquals(isNativeFileSystemAdapter(unmarked), false);

  try {
    WeakSet.prototype.add = (() => {
      throw new Error("ambient WeakSet.add must not be called");
    }) as typeof WeakSet.prototype.add;
    WeakSet.prototype.has = (() => true) as typeof WeakSet.prototype.has;
    Reflect.apply = (() => {
      throw new Error("ambient Reflect.apply must not be called");
    }) as typeof Reflect.apply;

    markNativeFileSystemAdapter(marked);
    assertEquals(isNativeFileSystemAdapter(unmarked), false);
    assertEquals(isNativeFileSystemAdapter(marked), true);
  } finally {
    Reflect.apply = originalReflectApply;
    WeakSet.prototype.has = originalHas;
    WeakSet.prototype.add = originalAdd;
  }
});
