import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createApiClient } from "../../../../../../cli/shared/config.ts";
import {
  hashAssetBytes,
  putBinaryKnowledgeAsset,
  readKnowledgeBundle,
} from "../../../../../../cli/commands/knowledge/binary-assets.ts";

const ID = "11111111-1111-4111-8111-111111111111";
it("publishes exact non-UTF8 bytes with scoped CAS and verified identity", async () => {
  const localPath = await Deno.makeTempFile();
  const bytes = new Uint8Array([0xff, 0xfe, 0, 0x80, 13, 10]);
  await Deno.writeFile(localPath, bytes);
  const hash = await hashAssetBytes(bytes);
  let calls = 0;
  const client = createApiClient({
    apiUrl: "https://api.example.test",
    apiToken: "test",
    projectSlug: "project",
  }, async (url, init) => {
    calls++;
    assertEquals(
      String(url),
      `https://api.example.test/projects/project/knowledge/assets/knowledge%2Fassets%2Ftest.bin?branch_id=${ID}`,
    );
    assertEquals(init?.body, bytes);
    assertEquals(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assertEquals(headers.get("content-type"), "application/octet-stream");
    assertEquals(headers.get("x-vf-content-sha256"), hash);
    assertEquals(headers.get("x-vf-expected-absent"), "true");
    return Response.json({
      file_id: ID,
      file_version_id: ID,
      path: "knowledge/assets/test.bin",
      byte_size: bytes.length,
      content_hash: hash,
      content_type: "application/octet-stream",
    });
  });
  try {
    const receipt = await putBinaryKnowledgeAsset({
      client,
      project: "project",
      path: "knowledge/assets/test.bin",
      localPath,
      branch: ID,
      expected: { kind: "absent" },
    });
    assertEquals(receipt.version_id, ID);
    assertEquals(receipt.checksum, hash);
    assertEquals(calls, 1);
  } finally {
    await Deno.remove(localPath);
  }
});

it("does not retry ambiguous binary writes and honors cancellation", async () => {
  const localPath = await Deno.makeTempFile();
  await Deno.writeFile(localPath, new Uint8Array([0xff]));
  let calls = 0;
  const client = createApiClient({
    apiUrl: "https://api.example.test",
    apiToken: "test",
    projectSlug: "project",
  }, () => {
    calls++;
    return Promise.resolve(new Response("unavailable", { status: 503 }));
  });
  const input = {
    client,
    project: "project",
    path: "knowledge/test.bin",
    localPath,
    branch: ID,
    expected: { kind: "absent" as const },
  };
  try {
    await assertRejects(() => putBinaryKnowledgeAsset(input), Error, "503");
    assertEquals(calls, 1);
    const controller = new AbortController();
    controller.abort();
    await assertRejects(() => putBinaryKnowledgeAsset({ ...input, signal: controller.signal }));
    assertEquals(calls, 1);
    await assertRejects(
      () => putBinaryKnowledgeAsset({ ...input, path: "knowledge/../escape" }),
      Error,
      "canonical",
    );
    assertEquals(calls, 1);
  } finally {
    await Deno.remove(localPath);
  }
});

it("exports BOM Markdown and binary companions with exact bytes and scoped immutable reads", async () => {
  const text = "\ufeff---\r\ntype: Concept\r\ncustom: preserved\r\n---\r\n![asset](image.bin)\r\n";
  const raw = new Uint8Array([0, 255, 254, 128]);
  const textBytes = new TextEncoder().encode(text);
  const hash = await hashAssetBytes(raw);
  const contentPath =
    `/projects/${ID}/knowledge/assets/knowledge%2Fbundle%2Fimage.bin?branch_id=${ID}&file_version_id=${ID}&content_hash=${hash}`;
  const manifest = {
    project_id: ID,
    root_path: "knowledge/bundle",
    selector: { type: "preview_branch", id: ID },
    file_count: 2,
    total_bytes: textBytes.length + raw.length,
    files: [
      {
        kind: "text",
        path: "knowledge/bundle/topic.md",
        file_id: ID,
        file_version_id: ID,
        byte_size: textBytes.length,
        content_hash: await hashAssetBytes(textBytes),
        content: text,
      },
      {
        kind: "binary",
        path: "knowledge/bundle/image.bin",
        file_id: ID,
        file_version_id: ID,
        byte_size: raw.length,
        content_hash: hash,
        content_type: "application/octet-stream",
        content_path: contentPath,
      },
    ],
  };
  const calls: string[] = [];
  const client = createApiClient({
    apiUrl: "https://api.example.test",
    apiToken: "test",
    projectSlug: "project",
  }, (url) => {
    calls.push(String(url));
    return Promise.resolve(
      String(url).includes("bundles/export")
        ? Response.json(manifest)
        : new Response(raw, { headers: { "content-type": "application/octet-stream" } }),
    );
  });
  const files = await readKnowledgeBundle({
    client,
    project: ID,
    rootPath: "knowledge/bundle",
    scope: { kind: "branch", branchId: ID },
  });
  assertEquals(files.map((file) => file.bytes), [textBytes, raw]);
  assertEquals(calls[1], `https://api.example.test${contentPath}`);
  const binaryEntry = manifest.files[1];
  if (!binaryEntry) throw new Error("Missing binary fixture");
  binaryEntry.content_path = contentPath.replace(ID, "22222222-2222-4222-8222-222222222222");
  await assertRejects(
    () =>
      readKnowledgeBundle({
        client,
        project: ID,
        rootPath: "knowledge/bundle",
        scope: { kind: "branch", branchId: ID },
      }),
    Error,
    "bound to its owner",
  );
});

it("rejects digest mismatch, duplicate paths and oversized exports before accepting bytes", async () => {
  const bytes = new Uint8Array([1, 2]);
  const file = {
    kind: "text",
    path: "knowledge/bundle/a.md",
    file_id: ID,
    file_version_id: ID,
    byte_size: 2,
    content_hash: await hashAssetBytes(bytes),
    content: "ab",
  };
  const manifest = {
    project_id: ID,
    root_path: "knowledge/bundle",
    selector: { type: "preview_branch", id: ID },
    file_count: 1,
    total_bytes: 2,
    files: [file],
  };
  const client = createApiClient({
    apiUrl: "https://api.example.test",
    apiToken: "test",
    projectSlug: "project",
  }, () => Promise.resolve(Response.json(manifest)));
  const input = {
    client,
    project: ID,
    rootPath: "knowledge/bundle",
    scope: { kind: "branch" as const, branchId: ID },
  };
  await assertRejects(() => readKnowledgeBundle(input), Error, "immutable digest");
  file.content_hash = await hashAssetBytes(new TextEncoder().encode("ab"));
  manifest.files.push({ ...file });
  manifest.file_count = 2;
  manifest.total_bytes = 4;
  await assertRejects(() => readKnowledgeBundle(input), Error, "Duplicate");
  manifest.files = [{ ...file, byte_size: 8 * 1024 * 1024 + 1 }];
  manifest.file_count = 1;
  manifest.total_bytes = 8 * 1024 * 1024 + 1;
  await assertRejects(() => readKnowledgeBundle(input), Error, "Invalid knowledge bundle entry");
});

it("sends the expected version for edits and rejects a substituted identity receipt", async () => {
  const localPath = await Deno.makeTempFile();
  await Deno.writeFile(localPath, new Uint8Array([255]));
  let calls = 0;
  const client = createApiClient({
    apiUrl: "https://api.example.test",
    apiToken: "test",
    projectSlug: "project",
  }, (_url, init) => {
    calls++;
    const headers = new Headers(init?.headers);
    assertEquals(headers.get("x-vf-expected-version-id"), ID);
    assertEquals(headers.get("x-vf-expected-absent"), null);
    return Promise.resolve(
      Response.json({
        file_id: ID,
        file_version_id: ID,
        path: "knowledge/replaced.bin",
        byte_size: 1,
        content_hash: "0".repeat(64),
        content_type: "application/octet-stream",
      }),
    );
  });
  try {
    await assertRejects(
      () =>
        putBinaryKnowledgeAsset({
          client,
          project: "project",
          path: "knowledge/original.bin",
          localPath,
          branch: ID,
          expected: { kind: "version", versionId: ID },
        }),
      Error,
      "invalid identity receipt",
    );
    assertEquals(calls, 1);
  } finally {
    await Deno.remove(localPath);
  }
});

it("resolves a supported branch name before raw publication", async () => {
  const localPath = await Deno.makeTempFile();
  const bytes = new Uint8Array([255]);
  await Deno.writeFile(localPath, bytes);
  const hash = await hashAssetBytes(bytes);
  let reads = 0;
  let writes = 0;
  const client = createApiClient({
    apiUrl: "https://api.example.test",
    apiToken: "test",
    projectSlug: "project",
  }, (url, init) => {
    if (init?.method === "GET") {
      reads++;
      return Promise.resolve(
        Response.json({ data: [{ id: ID, name: "feature/docs" }], page_info: { next: null } }),
      );
    }
    writes++;
    assertEquals(new URL(String(url)).searchParams.get("branch_id"), ID);
    return Promise.resolve(
      Response.json({
        file_id: ID,
        file_version_id: ID,
        path: "knowledge/image.bin",
        byte_size: 1,
        content_hash: hash,
        content_type: "application/octet-stream",
      }),
    );
  });
  try {
    await putBinaryKnowledgeAsset({
      client,
      project: "project",
      path: "knowledge/image.bin",
      localPath,
      branch: "feature/docs",
      expected: { kind: "absent" },
    });
    assertEquals([reads, writes], [1, 1]);
  } finally {
    await Deno.remove(localPath);
  }
});

it("keeps a configured API base path for binary writes", async () => {
  const client = createApiClient({
    apiUrl: "https://api.example.test/control",
    apiToken: "test",
    projectSlug: "project",
  }, (url) => {
    assertEquals(
      String(url),
      "https://api.example.test/control/projects/project/knowledge/assets/a",
    );
    return Promise.resolve(Response.json({ success: true }));
  });
  if (!client.putBytes) throw new Error("Missing raw transport");
  await client.putBytes("/projects/project/knowledge/assets/a", new Uint8Array([255]), {});
});

it("exports the default knowledge root", async () => {
  const client = createApiClient({
    apiUrl: "https://api.example.test",
    apiToken: "test",
    projectSlug: "project",
  }, (url) => {
    assertEquals(new URL(String(url)).searchParams.get("root_path"), "knowledge");
    return Promise.resolve(
      Response.json({
        project_id: ID,
        root_path: "knowledge",
        selector: { type: "main_branch", id: ID },
        file_count: 0,
        total_bytes: 0,
        files: [],
      }),
    );
  });
  assertEquals(
    await readKnowledgeBundle({
      client,
      project: ID,
      rootPath: "knowledge",
      scope: { kind: "branch", branchId: "main" },
    }),
    [],
  );
});
