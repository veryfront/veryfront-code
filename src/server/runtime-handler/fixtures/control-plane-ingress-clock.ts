await (async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const { assertEquals, assertNotEquals, assertRejects } = await import(
      "#veryfront/testing/assert.ts"
    );
    const { prepareDeclarativeConfigContext } = await import(
      "#veryfront/config/declarative-evaluator.ts"
    );
    const { resolveAdapter } = await import("../adapter-factory.ts");
    const { ProjectRunExecuteHandler } = await import(
      "../../handlers/request/project-run-execute.handler.ts"
    );
    const { createCtx } = await import("../../handlers/request/internal-agent-run.test-helpers.ts");
    const { base64urlEncode, base64urlEncodeBytes } = await import("#veryfront/utils/base64url.ts");
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    if (!("publicKey" in pair)) throw new Error("Expected asymmetric key pair");
    const der = await crypto.subtle.exportKey("spki", pair.publicKey);
    const pem = `-----BEGIN PUBLIC KEY-----\n${
      btoa(String.fromCharCode(...new Uint8Array(der)))
    }\n-----END PUBLIC KEY-----`;
    const mode = new URL(import.meta.url).searchParams.get("case") ?? "delayed";
    const runId = mode === "encoded" ? "run%31" : "run-cold";
    const objectBody = JSON.stringify({
      ...(mode === "missing-run" ? {} : { runId }),
      ...(mode === "missing-project" ? {} : { projectId: "proj-1" }),
      kind: "task",
      target: "task:knowledge-ingest",
      config: { mode: "index_existing_canonical" },
    });
    const body = mode === "malformed-json"
      ? "{"
      : mode === "null"
      ? "null"
      : mode === "array"
      ? "[]"
      : mode === "primitive"
      ? "7"
      : mode === "inherited-identity"
      ? JSON.stringify({ __proto__: { runId, projectId: "proj-1" } })
      : objectBody;
    const path = `/api/control-plane/runs/${runId}/execute`;
    const encodedHeader = base64urlEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
    const encodedPayload = base64urlEncode(JSON.stringify({
      iss: "veryfront-api",
      aud: "demo-project",
      sub: mode === "wrong-subject" ? "foreign-run" : runId,
      surface: "studio",
      project_id: "proj-1",
      request_hash: base64urlEncodeBytes(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))),
      ),
      request_method: "POST",
      request_path: path,
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 300,
    }));
    const sig = await crypto.subtle.sign(
      "Ed25519",
      pair.privateKey,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
    const abortController = new AbortController();
    if (mode === "aborted-body") abortController.abort();
    if (mode === "hosted-cancelled-body") {
      const { createHostedConfigRequestCancellation } = await import(
        "#veryfront/config/request-cancellation.ts"
      );
      abortController.abort(createHostedConfigRequestCancellation());
    }
    const readFailureModes = [
      "invalid-utf8",
      "errored-stream",
      "aborted-body",
      "hosted-cancelled-body",
      "consumed-body",
    ];
    const req = new Request(`https://demo-project.preview.veryfront.org${path}`, {
      method: "POST",
      signal: abortController.signal,
      headers: {
        "x-veryfront-control-plane-jws": `${encodedHeader}.${encodedPayload}.${
          base64urlEncodeBytes(new Uint8Array(sig))
        }`,
      },
      body: mode === "invalid-utf8"
        ? new Uint8Array([255])
        : mode === "errored-stream"
        ? new ReadableStream({
          start(controller) {
            controller.error(new Error("private stream detail"));
          },
        })
        : mode === "oversize"
        ? "x".repeat(2 * 1024 * 1024)
        : mode === "tampered-body"
        ? body + " "
        : body,
    });
    if (mode === "consumed-body") await req.text();
    const ctx = createCtx(pem);
    let listings = 0;
    Object.assign(ctx.adapter.fs, {
      readFile: async () => {
        throw new Deno.errors.NotFound("test config absent");
      },
      exists: async () => false,
      isMultiProjectMode: () => true,
      runWithContext: async <T>(_slug: string, _token: string, operation: () => Promise<T>) => {
        listings++;
        if (listings === 1) now += 61_000;
        return await operation();
      },
    });
    ctx.proxyToken = "test-only-invocation";
    const resolve = () =>
      resolveAdapter({
        req,
        projectDir: "/project",
        adapter: ctx.adapter,
        config: undefined,
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
        proxyToken: ctx.proxyToken,
        releaseId: undefined,
        proxyEnv: "preview",
        branch: "main",
        environmentName: "preview",
        parsedDomain: {
          slug: null,
          branch: null,
          environment: null,
          isVeryfrontDomain: false,
          isDraft: false,
          allowIframeEmbed: false,
        },
        pathname: path,
        isProxyMode: true,
        proxyTrusted: false,
        prepareHostedConfigContext: async () => ({
          sourceContext: { productionMode: false, branch: "main" },
          preparedContext: await prepareDeclarativeConfigContext({
            environmentName: "preview",
            environment: {},
          }),
        }),
      });
    if (mode === "stale") now += 61_000;
    if (mode === "foreign") ctx.projectId = "foreign-project";
    if (
      [
        "stale",
        "foreign",
        "oversize",
        "wrong-subject",
        "tampered-body",
        "missing-project",
        "missing-run",
        "malformed-json",
        "null",
        "array",
        "primitive",
        "inherited-identity",
        ...readFailureModes,
      ].includes(mode)
    ) {
      const { withRequestTimeout } = await import("../timeout-manager.ts");
      const { response } = await withRequestTimeout(
        async () => {
          await resolve();
          return new Response();
        },
        path,
        "POST",
        { signal: abortController.signal },
      );
      if (mode === "hosted-cancelled-body") {
        assertEquals(response.status, 499);
        assertEquals(await response.text(), "");
        assertEquals(listings, 0);
        return;
      }
      assertEquals(
        response.status,
        mode === "oversize" ? 413 : readFailureModes.includes(mode) ? 400 : 401,
      );
      const payload = await response.json();
      assertEquals(typeof payload.error, "string");
      if (readFailureModes.includes(mode)) {
        assertEquals(payload.error, "Invalid project run execute request");
      }
      assertEquals(JSON.stringify(payload).includes(pem), false);
      assertEquals(listings, 0, "refused ingress must not touch tenant filesystem");
      return;
    }
    const clone = mode === "clone" ? req.clone() : undefined;
    await resolve();
    assertEquals(req.bodyUsed, true, "factory consumes bounded body once");
    if (mode === "replay") {
      const before = listings;
      await assertRejects(resolve);
      assertEquals(listings, before);
      return;
    }
    if (mode === "expired") now += 300_000;
    const result = await new ProjectRunExecuteHandler().handle(clone ?? req, ctx);
    if (mode === "clone" || mode === "expired") {
      assertEquals(result.response?.status, 401);
      return;
    }

    assertEquals(listings >= 1, true);
    assertNotEquals(
      result.response?.status,
      401,
      "framework setup must not age an already verified invocation",
    );
  } finally {
    Date.now = originalNow;
  }
})();
self.postMessage({ passed: true });
