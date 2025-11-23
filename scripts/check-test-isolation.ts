#!/usr/bin/env -S deno run -A
/*
 Test isolation checker for Veryfront
 Fails CI on common anti-patterns that cause cross-machine flakiness.
*/

import { walk } from "jsr:@std/fs@^1.0.2/walk";

const TEST_ROOT = new URL("../tests/", import.meta.url).pathname;

interface Violation {
  file: string;
  line?: number;
  message: string;
  severity: "error" | "warning";
}

const violations: Violation[] = [];

const encoder = new TextEncoder();
function log(msg: string) {
  Deno.stdout.writeSync(encoder.encode(msg + "\n"));
}

function checkFile(path: string, text: string) {
  const rel = path.replace(Deno.cwd() + "/", "");

  // 1) (deprecated) Previously disallowed awaiting startProductionServer.
  // New API returns a handle; awaiting it is fine. No check here.

  // 2) Encourage dynamic free ports when starting prod server
  if (/startProductionServer\s*\(/.test(text)) {
    if (!/getFreePort\s*\(/.test(text)) {
      violations.push({ file: rel, message: "Use getFreePort() for dynamic port selection in tests starting the production server.", severity: "warning" });
    }
  }

  // 3) Discourage hard-coded ports in tests
  {
    const re = /const\s+port\s*=\s*\d{3,5}\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const before = text.slice(0, m.index);
      const line = before.split("\n").length;
      // Only enforce for production server startup patterns
      if (/startProductionServer\s*\(/.test(text)) {
        violations.push({ file: rel, line, message: "Avoid hard-coded ports in tests; use getFreePort().", severity: "warning" });
      }
    }
  }

  // 4) RSC: forbid legacy flight endpoint
  if (/_veryfront\/rsc\/flight\?/.test(text)) {
    violations.push({ file: rel, message: "Use /_veryfront/rsc/flight_page instead of legacy /flight endpoint in tests.", severity: "error" });
  }

  // 5) RSC: if actually fetching core endpoints (payload/manifest/page/stream), require env flag handling
  {
    const rscFetchRe = /fetch\([^)]*\/_veryfront\/rsc\/(payload|manifest|page|stream)/g;
    if (rscFetchRe.test(text)) {
      if (!/VERYFRONT_EXPERIMENTAL_RSC/.test(text)) {
        violations.push({ file: rel, message: "Tests hitting RSC endpoints should set/restore VERYFRONT_EXPERIMENTAL_RSC.", severity: "warning" });
      }
    }
  }
}

for await (const entry of walk(TEST_ROOT, { includeFiles: true, includeDirs: false, exts: [".ts", ".tsx"] })) {
  const text = await Deno.readTextFile(entry.path);
  checkFile(entry.path, text);
}

if (violations.length) {
  const enforce = (Deno.env.get("VF_ENFORCE_ISO") || "").trim() === "1";
  const errors = violations.filter((v) => v.severity === "error");
  log("Test isolation check" + (enforce && errors.length ? " failed" : " warnings") + " with violations:\n");
  for (const v of violations) {
    log(`- ${v.file}${v.line ? ":" + v.line : ""} - ${v.message}`);
  }
  if (enforce && errors.length) Deno.exit(1);
} else {
  log("Test isolation check passed.");
}
