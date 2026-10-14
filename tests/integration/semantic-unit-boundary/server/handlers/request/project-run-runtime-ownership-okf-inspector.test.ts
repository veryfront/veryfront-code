import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { inspectRuntimeOwnershipOkfDocument } from "../../../../../../src/server/handlers/request/project-run-runtime-ownership-okf-inspector.ts";

const sourcePath =
  "knowledge/context-runtime-host-owned-stage-probe-20261011/probe/run/session/ownership.md";
const body =
  "project-run-runtime-ownership\nstage-probe\nevent-id\n\ncurrent-write\nrun-id\nsource-path";
const content = `---\ntype: concept\ntitle: Runtime ownership proof\n---\n${body}`;

function withPoisonedIntrinsics<T>(callback: () => T): T {
  const create = Object.create;
  const defineProperty = Object.defineProperty;
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const descriptors: Array<
    [object, PropertyKey, PropertyDescriptor | undefined]
  > = [];
  const copyDescriptor = (descriptor: PropertyDescriptor | undefined) => {
    if (descriptor === undefined) return undefined;
    const copy = create(null) as PropertyDescriptor;
    if ("value" in descriptor) copy.value = descriptor.value;
    if ("writable" in descriptor) copy.writable = descriptor.writable;
    if ("get" in descriptor) copy.get = descriptor.get;
    if ("set" in descriptor) copy.set = descriptor.set;
    copy.enumerable = descriptor.enumerable;
    copy.configurable = descriptor.configurable;
    return copy;
  };
  const replace = (target: object, key: PropertyKey, value: unknown) => {
    descriptors.push([
      target,
      key,
      copyDescriptor(getOwnPropertyDescriptor(target, key)),
    ]);
    const descriptor = create(null) as PropertyDescriptor;
    descriptor.configurable = true;
    descriptor.writable = true;
    descriptor.value = value;
    defineProperty(target, key, descriptor);
  };
  const poisoned = (label: string) => () => {
    throw new Error(`poisoned intrinsic invoked: ${label}`);
  };
  replace(String.prototype, "replaceAll", poisoned("String.replaceAll"));
  replace(String.prototype, "replace", poisoned("String.replace"));
  replace(String.prototype, "slice", poisoned("String.slice"));
  replace(String.prototype, "lastIndexOf", poisoned("String.lastIndexOf"));
  replace(String.prototype, "startsWith", poisoned("String.startsWith"));
  replace(String.prototype, "trim", poisoned("String.trim"));
  replace(String.prototype, "split", poisoned("String.split"));
  replace(String.prototype, "indexOf", poisoned("String.indexOf"));
  replace(String.prototype, "charCodeAt", poisoned("String.charCodeAt"));
  replace(RegExp.prototype, "exec", poisoned("RegExp.exec"));
  replace(RegExp.prototype, "test", poisoned("RegExp.test"));
  replace(Object, "keys", poisoned("Object.keys"));
  replace(Object, "getPrototypeOf", poisoned("Object.getPrototypeOf"));
  replace(
    Object,
    "getOwnPropertyDescriptor",
    poisoned("Object.getOwnPropertyDescriptor"),
  );
  replace(JSON, "stringify", poisoned("JSON.stringify"));
  replace(Object.prototype, "get", poisoned("Object.prototype.get"));
  replace(Object.prototype, "set", poisoned("Object.prototype.set"));
  try {
    return callback();
  } finally {
    for (let index = descriptors.length - 1; index >= 0; index--) {
      const [target, key, descriptor] = descriptors[index]!;
      if (descriptor === undefined) Reflect.deleteProperty(target, key);
      else defineProperty(target, key, descriptor);
    }
  }
}

describe("runtime ownership OKF inspector", () => {
  it("extracts host proof body and data-only metadata with exact offsets", () => {
    const inspected = inspectRuntimeOwnershipOkfDocument(sourcePath, content);
    assertEquals(inspected.body, body);
    assertEquals(content.length - inspected.body.length, 53);
    assertEquals(Object.getPrototypeOf(inspected.metadata), null);
    assertEquals(inspected.metadata.type, "concept");
    assertEquals(inspected.metadata.title, "Runtime ownership proof");
  });

  it("does not dispatch through mutable shared-runtime intrinsics", () => {
    const inspected = withPoisonedIntrinsics(() =>
      inspectRuntimeOwnershipOkfDocument(sourcePath, content)
    );
    assertEquals(inspected.body, body);
    assertEquals(content.length - inspected.body.length, 53);
    assertEquals(Object.getPrototypeOf(inspected.metadata), null);
    assertEquals(inspected.metadata.type, "concept");
    assertEquals(inspected.metadata.title, "Runtime ownership proof");
  });

  it("preserves CRLF body bytes after the frontmatter delimiter", () => {
    const crlfBody = "project-run-runtime-ownership\r\nstage-probe\r\n";
    const inspected = inspectRuntimeOwnershipOkfDocument(
      sourcePath,
      `---\r\ntype: concept\r\ntitle: Runtime ownership proof\r\n---\r\n${crlfBody}`,
    );
    assertEquals(inspected.body, crlfBody);
  });

  it("fails closed on unsupported YAML before callers can commit retained bytes", () => {
    for (
      const frontmatter of [
        "type: concept\nnested:\n  title: Runtime ownership proof",
        "type: concept\ntitle: &title Runtime ownership proof",
        "type: concept\ntitle: Runtime ownership proof\ntitle: Other",
        "type: concept\n__proto__: polluted",
        "type: concept\ntags: [runtime, ownership]",
        'type: concept\ntitle: "unterminated',
        "type: concept\ntitle: 'Runtime ownership proof '' escaped'",
        'type: concept\ntitle: "Runtime ownership proof \\" escaped"',
      ]
    ) {
      assertThrows(
        () =>
          inspectRuntimeOwnershipOkfDocument(
            sourcePath,
            `---\n${frontmatter}\n---\n${body}`,
          ),
        Error,
        "Unsupported OKF frontmatter for runtime ownership proof",
      );
    }
  });
});
