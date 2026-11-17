import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type AuditExemption,
  evaluateStorybookAudit,
  STORYBOOK_AUDIT_EXEMPTIONS,
} from "./audit-storybook.ts";

const PICOMATCH_EXEMPTION: AuditExemption = {
  id: "GHSA-fc5q-39xc-vjpf",
  package: "picomatch",
  range: "<=4.0.7",
  unpatchedLatest: "4.0.7",
  reason: "test",
};

const LATEST = { picomatch: "4.0.7" };

function advisory(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: 1247710,
    name: "picomatch",
    dependency: "picomatch",
    title: "picomatch vulnerable to ReDoS",
    url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
    severity: "high",
    range: "<=4.0.7",
    ...overrides,
  };
}

// The shape npm reports: picomatch carries the advisory, the packages that
// depend on it inherit it by name, including a cycle through tinyglobby.
function report(vulnerabilities: Record<string, unknown>): Record<string, unknown> {
  return { auditReportVersion: 2, vulnerabilities };
}

function picomatchReport(picomatchVia: unknown[] = [advisory()]): Record<string, unknown> {
  return report({
    picomatch: { name: "picomatch", severity: "high", via: picomatchVia },
    fdir: { name: "fdir", severity: "high", via: ["picomatch"] },
    tinyglobby: { name: "tinyglobby", severity: "high", via: ["fdir", "picomatch"] },
    vite: { name: "vite", severity: "high", via: ["fdir", "picomatch", "tinyglobby"] },
  });
}

describe("evaluateStorybookAudit", () => {
  it("blocks every affected package when the advisory is not exempted", () => {
    const result = evaluateStorybookAudit(picomatchReport(), [], LATEST);

    assertEquals(result.blocking.map((finding) => finding.package), [
      "fdir",
      "picomatch",
      "tinyglobby",
      "vite",
    ]);
    assertEquals(result.blocking[0]!.advisories.map((entry) => entry.id), ["GHSA-fc5q-39xc-vjpf"]);
  });

  it("passes when the only high advisory is exempted, including inherited findings", () => {
    const result = evaluateStorybookAudit(picomatchReport(), [PICOMATCH_EXEMPTION], LATEST);

    assertEquals(result.blocking, []);
    assertEquals(result.appliedExemptions, [PICOMATCH_EXEMPTION]);
    assertEquals(result.unusedExemptions, []);
  });

  it("stops exempting the advisory once its vulnerable range changes", () => {
    const result = evaluateStorybookAudit(
      picomatchReport([advisory({ range: "<4.0.8" })]),
      [PICOMATCH_EXEMPTION],
      LATEST,
    );

    assertEquals(result.blocking.length, 4);
    assertEquals(result.unusedExemptions, [PICOMATCH_EXEMPTION]);
  });

  it("stops exempting the advisory once the package ships a newer release", () => {
    const result = evaluateStorybookAudit(picomatchReport(), [PICOMATCH_EXEMPTION], {
      picomatch: "4.0.8",
    });

    assertEquals(result.blocking.length, 4);
    assertEquals(result.blocking[1]!.advisories.map((entry) => entry.id), ["GHSA-fc5q-39xc-vjpf"]);
    assertEquals(result.unusedExemptions, [PICOMATCH_EXEMPTION]);
  });

  it("does not exempt when the package's latest release is unknown", () => {
    const result = evaluateStorybookAudit(picomatchReport(), [PICOMATCH_EXEMPTION], {});

    assertEquals(result.blocking.length, 4);
  });

  it("does not exempt the same advisory id filed against another package", () => {
    const result = evaluateStorybookAudit(
      report({
        micromatch: {
          name: "micromatch",
          severity: "high",
          via: [advisory({ name: "micromatch" })],
        },
      }),
      [PICOMATCH_EXEMPTION],
      LATEST,
    );

    assertEquals(result.blocking.map((finding) => finding.package), ["micromatch"]);
  });

  it("blocks a second high advisory on an exempted package", () => {
    const other = advisory({
      url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
      range: "<4.0.3",
    });
    const result = evaluateStorybookAudit(
      picomatchReport([advisory(), other]),
      [PICOMATCH_EXEMPTION],
      LATEST,
    );

    assertEquals(result.blocking.length, 4);
    assertEquals(result.blocking[1]!.advisories.map((entry) => entry.id), ["GHSA-aaaa-bbbb-cccc"]);
  });

  it("blocks a critical advisory on an unrelated package", () => {
    const result = evaluateStorybookAudit(
      report({
        ...(picomatchReport().vulnerabilities as Record<string, unknown>),
        esbuild: {
          name: "esbuild",
          severity: "critical",
          via: [advisory({
            name: "esbuild",
            severity: "critical",
            url: "https://github.com/advisories/GHSA-dddd-eeee-ffff",
          })],
        },
      }),
      [PICOMATCH_EXEMPTION],
      LATEST,
    );

    assertEquals(result.blocking.map((finding) => finding.package), ["esbuild"]);
  });

  it("ignores moderate findings", () => {
    const result = evaluateStorybookAudit(
      report({
        postcss: {
          name: "postcss",
          severity: "moderate",
          via: [advisory({ name: "postcss", severity: "moderate" })],
        },
      }),
      [],
      LATEST,
    );

    assertEquals(result.blocking, []);
  });

  it("blocks a high package whose advisories cannot be read", () => {
    for (
      const via of [
        [],
        ["missing-package"],
        [advisory({ url: "https://example.com/not-an-advisory" })],
        [advisory({ range: undefined })],
        [42],
      ]
    ) {
      const result = evaluateStorybookAudit(
        report({ picomatch: { name: "picomatch", severity: "high", via } }),
        [PICOMATCH_EXEMPTION],
        LATEST,
      );
      assertEquals(
        result.blocking.map((finding) => finding.package),
        ["picomatch"],
        JSON.stringify(via),
      );
    }
  });

  it("blocks a high package that mixes an exempted advisory with an unreadable one", () => {
    const result = evaluateStorybookAudit(
      report({ picomatch: { name: "picomatch", severity: "high", via: [advisory(), {}] } }),
      [PICOMATCH_EXEMPTION],
      LATEST,
    );

    assertEquals(result.blocking.map((finding) => finding.package), ["picomatch"]);
  });

  it("blocks an entry without a severity", () => {
    const result = evaluateStorybookAudit(report({ picomatch: { via: [advisory()] } }), [
      PICOMATCH_EXEMPTION,
    ], LATEST);

    assertEquals(result.blocking.map((finding) => finding.package), ["picomatch"]);
  });

  it("rejects a report that is not an npm audit v2 report", () => {
    for (
      const invalid of [
        null,
        [],
        {},
        { auditReportVersion: 1, vulnerabilities: {} },
        { auditReportVersion: 2 },
        { auditReportVersion: 2, vulnerabilities: [] },
        { auditReportVersion: 2, vulnerabilities: {}, error: { code: "ENOLOCK" } },
      ]
    ) {
      assertThrows(() => evaluateStorybookAudit(invalid, [], LATEST), Error, undefined, JSON.stringify(invalid));
    }
  });

  it("reports an exemption that matches nothing as unused", () => {
    const result = evaluateStorybookAudit(report({}), [PICOMATCH_EXEMPTION], LATEST);

    assertEquals(result.blocking, []);
    assertEquals(result.unusedExemptions, [PICOMATCH_EXEMPTION]);
  });
});

describe("STORYBOOK_AUDIT_EXEMPTIONS", () => {
  it("pins every exemption to one advisory, package and range with a reason", () => {
    for (const exemption of STORYBOOK_AUDIT_EXEMPTIONS) {
      assertEquals(/^GHSA(-[0-9a-z]{4}){3}$/.test(exemption.id), true, exemption.id);
      assertEquals(exemption.package.length > 0, true, exemption.id);
      assertEquals(exemption.range.length > 0 && exemption.range !== "*", true, exemption.id);
      assertEquals(/^\d+\.\d+\.\d+$/.test(exemption.unpatchedLatest), true, exemption.id);
      assertEquals(exemption.reason.length > 20, true, exemption.id);
    }
  });
});
