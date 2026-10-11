import {
  createRuntimeOwnershipIndexProbe,
  type OwnershipIndexClient,
} from "./project-run-runtime-ownership-index-probe.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
const fileId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";
const sourcePath = "knowledge/owned/runtime-proof.md";
const content = "---\ntype: concept\ntitle: Runtime proof\n---\nComplete current canonical body.\n";
const NativeError = Error;

async function fixture() {
  let denied = false, changed = false, sourceVersion = versionId, embedCalls = 0;
  const wires: string[] = [];
  const checksum = await computeHash(content);
  const client: OwnershipIndexClient = {
    get: <T>() =>
      Promise.resolve(
        { id: fileId, version_id: sourceVersion, path: sourcePath, content, checksum } as T,
      ),
    post: <T>(_path: string, body?: unknown) => {
      assertEquals(body, {
        paths: [sourcePath],
        lookup_target: { kind: "preview_branch", branch_id: branchId },
      });
      return Promise.resolve(
        {
          data: [{
            path: sourcePath,
            file_id: fileId,
            file_version_id: sourceVersion,
            index_ready: true,
            marker: changed ? "changed" : "original",
          }],
        } as T,
      );
    },
    postRaw: <T>(_path: string, wire: string) => {
      wires.push(wire);
      if (denied) {
        return Promise.reject(new NativeError("Veryfront API request failed: 403 Forbidden"));
      }
      return Promise.resolve(
        {
          file_id: fileId,
          version_id: sourceVersion,
          path: sourcePath,
          checksum,
          indexed_chunk_count: 1,
          model: { provider: "openai", name: "text-embedding-3-small", dimension: 1536 },
        } as T,
      );
    },
  };
  const probe = createRuntimeOwnershipIndexProbe({
    projectId: "project",
    branchId,
    createWriter: () => client,
    createReader: () => client,
    embed: (text) => {
      embedCalls++;
      assertEquals(text, "Complete current canonical body.\n");
      return Promise.resolve(Array(1536).fill(0.125));
    },
  });
  const request = { sourcePath, content, signal: new AbortController().signal };
  return {
    probe,
    request,
    client,
    wires,
    deny: () => {
      denied = true;
    },
    change: () => {
      changed = true;
    },
    changeVersion: () => {
      sourceVersion = fileId;
    },
    embeds: () => embedCalls,
  };
}
describe("host-owned canonical index authority proof", () => {
  it("indexes complete current body and reuses exact real-provider vector bytes for denied stale writes", async () => {
    const f = await fixture();
    const current = await f.probe({ ...f.request, stale: false });
    f.deny();
    const stale = await f.probe({ ...f.request, stale: true });
    const payload = JSON.parse(f.wires[0]!) as {
      chunks: Array<{
        content: string;
        start_offset: number;
        end_offset: number;
        metadata: { title?: unknown; okf_metadata?: { title?: unknown } };
      }>;
    };
    assertEquals(payload.chunks[0]?.content, "Complete current canonical body.\n");
    assertEquals(
      payload.chunks[0]?.start_offset,
      content.length - "Complete current canonical body.\n".length,
    );
    assertEquals(payload.chunks[0]?.end_offset, content.length);
    assertEquals(payload.chunks[0]?.metadata.title, "Runtime proof");
    assertEquals(payload.chunks[0]?.metadata.okf_metadata?.title, "Runtime proof");
    assertEquals(current.authorizationDenied, false);
    assertEquals(stale.authorizationDenied, true);
    assertEquals(f.wires.length, 2);
    assertEquals(f.wires[0], f.wires[1]);
    assertEquals(f.embeds(), 1);
    assertEquals(stale.readinessBeforeHash, stale.readinessAfterHash);
  });
  it("fails an accepted stale write even when readiness is unchanged", async () => {
    const f = await fixture();
    await f.probe({ ...f.request, stale: false });
    await assertRejects(
      () => f.probe({ ...f.request, stale: true }),
      NativeError,
      "Stale canonical index was accepted",
    );
  });
  it("refuses stale replay after canonical version drift", async () => {
    const f = await fixture();
    await f.probe({ ...f.request, stale: false });
    f.changeVersion();
    f.deny();
    await assertRejects(
      () => f.probe({ ...f.request, stale: true }),
      NativeError,
      "No matching current canonical index receipt",
    );
    assertEquals(f.wires.length, 1);
  });
  it("does not substitute a conflict for authority denial", async () => {
    const f = await fixture();
    await f.probe({ ...f.request, stale: false });
    f.client.postRaw = () =>
      Promise.reject(new NativeError("Veryfront API request failed: 409 Conflict"));
    await assertRejects(
      () => f.probe({ ...f.request, stale: true }),
      NativeError,
      "without authorization denial",
    );
  });
  it("rejects incomplete provider vectors before canonical commit", async () => {
    const f = await fixture();
    const probe = createRuntimeOwnershipIndexProbe({
      projectId: "project",
      branchId,
      createWriter: () => f.client,
      createReader: () => f.client,
      embed: () => Promise.resolve([0.5]),
    });
    await assertRejects(
      () => probe({ ...f.request, stale: false }),
      NativeError,
      "vector is invalid",
    );
    assertEquals(f.wires.length, 0);
  });
  it("rejects finite values overflowing the stored float32 vector schema", async () => {
    const f = await fixture();
    const probe = createRuntimeOwnershipIndexProbe({
      projectId: "project",
      branchId,
      createWriter: () => f.client,
      createReader: () => f.client,
      embed: () => Promise.resolve(Array(1536).fill(Number.MAX_VALUE)),
    });
    await assertRejects(
      () => probe({ ...f.request, stale: false }),
      NativeError,
      "vector is invalid",
    );
    assertEquals(f.wires.length, 0);
  });
  it("rejects readiness changes across a denied replay", async () => {
    const f = await fixture();
    await f.probe({ ...f.request, stale: false });
    const original = f.client.postRaw;
    f.client.postRaw = (path, wire, options) => {
      f.change();
      return original(path, wire, options);
    };
    f.deny();
    await assertRejects(
      () => f.probe({ ...f.request, stale: true }),
      NativeError,
      "changed readiness",
    );
  });
});
