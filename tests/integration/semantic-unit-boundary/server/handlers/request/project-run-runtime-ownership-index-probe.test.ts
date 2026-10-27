/**
 * Exercises process-global intrinsic replacement around the host-owned OKF
 * parser inside canonical index proof, so it belongs in the semantic boundary
 * rather than the colocated unit suite.
 */
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  createRuntimeOwnershipIndexProbe,
  type OwnershipIndexClient,
} from "#veryfront/server/handlers/request/project-run-runtime-ownership-index-probe.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

const fileId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";
const sourcePath = "knowledge/owned/runtime-proof.md";
const content = "---\ntype: concept\ntitle: Runtime proof\n---\nComplete current canonical body.\n";
const NativeError = Error;

function withPoisonedParserIntrinsics<T>(callback: () => Promise<T>): Promise<T> {
  const defineProperty = Object.defineProperty;
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const descriptors: Array<[object, PropertyKey, PropertyDescriptor | undefined]> = [];
  const replace = (target: object, key: PropertyKey, value: unknown) => {
    descriptors.push([target, key, getOwnPropertyDescriptor(target, key)]);
    defineProperty(target, key, { configurable: true, writable: true, value });
  };
  const poisoned = (label: string) => () => {
    throw new NativeError(`poisoned parser intrinsic invoked: ${label}`);
  };
  replace(String.prototype, "slice", poisoned("String.slice"));
  replace(String.prototype, "startsWith", poisoned("String.startsWith"));
  replace(String.prototype, "trim", poisoned("String.trim"));
  replace(RegExp.prototype, "exec", poisoned("RegExp.exec"));
  replace(RegExp.prototype, "test", poisoned("RegExp.test"));
  replace(Object, "getOwnPropertyDescriptor", poisoned("Object.getOwnPropertyDescriptor"));
  replace(JSON, "stringify", poisoned("JSON.stringify"));
  return callback().finally(() => {
    for (let index = descriptors.length - 1; index >= 0; index--) {
      const [target, key, descriptor] = descriptors[index]!;
      if (descriptor === undefined) Reflect.deleteProperty(target, key);
      else defineProperty(target, key, descriptor);
    }
  });
}

async function fixture() {
  const wires: string[] = [];
  const checksum = await computeHash(content);
  const client: OwnershipIndexClient = {
    get: <T>() =>
      Promise.resolve(
        { id: fileId, version_id: versionId, path: sourcePath, content, checksum } as T,
      ),
    post: <T>() =>
      Promise.resolve({
        data: [{
          path: sourcePath,
          file_id: fileId,
          file_version_id: versionId,
          index_ready: true,
        }],
      } as T),
    postRaw: <T>(_path: string, wire: string) => {
      wires.push(wire);
      return Promise.resolve({
        file_id: fileId,
        version_id: versionId,
        path: sourcePath,
        checksum,
        indexed_chunk_count: 1,
        model: { provider: "google", name: "gemini-embedding-001", dimension: 3072 },
      } as T);
    },
  };
  const probe = createRuntimeOwnershipIndexProbe({
    projectId: "project",
    branchId,
    createWriter: () => client,
    createReader: () => client,
    embed: (text) => {
      assertEquals(text, "Complete current canonical body.\n");
      return Promise.resolve(Array(3072).fill(0.125));
    },
  });
  return { probe, request: { sourcePath, content, signal: new AbortController().signal }, wires };
}

it("indexes the host-owned OKF body while parser intrinsics are poisoned", async () => {
  const f = await fixture();
  await withPoisonedParserIntrinsics(() => f.probe({ ...f.request, stale: false }));
  const payload = JSON.parse(f.wires[0]!) as {
    chunks: Array<{ content: string; start_offset: number; end_offset: number }>;
  };
  assertEquals(payload.chunks[0]?.content, "Complete current canonical body.\n");
  assertEquals(
    payload.chunks[0]?.start_offset,
    content.length - "Complete current canonical body.\n".length,
  );
  assertEquals(payload.chunks[0]?.end_offset, content.length);
});
