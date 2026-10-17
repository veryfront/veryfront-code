import { extractRequestHeaders } from "#veryfront/server/runtime-handler/project-resolution.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  decodeIdentityHeaderValue,
  encodeIdentityHeaderValue,
} from "#veryfront/utils/header-identity.ts";

it("keeps identity encoding and decoding stable after project intrinsic replacement", () => {
  const trim = String.prototype.trim;
  const charCodeAt = String.prototype.charCodeAt;
  const startsWith = String.prototype.startsWith;
  const slice = String.prototype.slice;
  const encode = globalThis.encodeURIComponent;
  const decode = globalThis.decodeURIComponent;
  let encoded: string | undefined;
  let decoded: string | undefined;
  try {
    String.prototype.trim = () => "poisoned";
    String.prototype.charCodeAt = () => 65;
    String.prototype.startsWith = () => false;
    String.prototype.slice = () => "poisoned";
    globalThis.encodeURIComponent = () => "poisoned";
    globalThis.decodeURIComponent = () => "poisoned";
    encoded = encodeIdentityHeaderValue("日本語\nblue");
    decoded = decodeIdentityHeaderValue("vf-utf8:%E6%97%A5%E6%9C%AC%E8%AA%9E%0Ablue");
  } finally {
    String.prototype.trim = trim;
    String.prototype.charCodeAt = charCodeAt;
    String.prototype.startsWith = startsWith;
    String.prototype.slice = slice;
    globalThis.encodeURIComponent = encode;
    globalThis.decodeURIComponent = decode;
  }
  assertEquals(encoded, "vf-utf8:%E6%97%A5%E6%9C%AC%E8%AA%9E%0Ablue");
  assertEquals(decoded, "日本語\nblue");
});

it("preserves trusted source labels after project trim replacement", () => {
  const req = new Request("http://localhost/", {
    headers: {
      "x-project-slug": " safe-project ",
      "x-branch-name": "vf-utf8:%20feature%2F%E6%97%A5%E6%9C%AC%E8%AA%9E%20",
      "x-default-branch-name": "vf-utf8:%20trunk%20",
      "x-environment-name": "vf-utf8:%20%E6%97%A5%E6%9C%AC%E8%AA%9E%20",
    },
  });
  const url = new URL(req.url);
  const trim = String.prototype.trim;
  let result: ReturnType<typeof extractRequestHeaders> | undefined;
  try {
    String.prototype.trim = () => "forged-environment";
    result = extractRequestHeaders(req, url, false, true);
  } finally {
    String.prototype.trim = trim;
  }
  assertEquals(result?.projectSlug, "safe-project");
  assertEquals(result?.branchName, "feature/日本語");
  assertEquals(result?.defaultBranchName, "trunk");
  assertEquals(result?.environmentName, "日本語");
});
