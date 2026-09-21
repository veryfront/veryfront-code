import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  adoptedPackageJsonPins,
  classifyPackageJsonDrift,
  type DependencyPreimage,
  formatAdoptedPins,
  pinsRequiringConsent,
} from "./dependency-pins.ts";

/** Serialize exactly the way the API's package.json writer does. */
function apiWrite(pkg: Record<string, unknown>): string {
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

const BASELINE_PKG = {
  name: "demo",
  private: true,
  scripts: { dev: "veryfront dev" },
  dependencies: { react: "^19.2.4", zod: "~3.25.0" },
};

const PINNED_PKG = {
  name: "demo",
  private: true,
  scripts: { dev: "veryfront dev" },
  dependencies: { react: "19.3.0", zod: "3.25.7" },
};

const BASELINE_CONTENT = apiWrite(BASELINE_PKG);
const PINNED_CONTENT = apiWrite(PINNED_PKG);

const PREIMAGES: DependencyPreimage[] = [
  { react: "^19.2.4", zod: "~3.25.0" },
  { react: "19.3.0", zod: "3.25.7" },
];

describe("classifyPackageJsonDrift", () => {
  it("adopts a pure pin tightening backed by a published preimage", () => {
    assertEquals(
      classifyPackageJsonDrift(BASELINE_CONTENT, PINNED_CONTENT, PREIMAGES),
      "server-pins",
    );
    assertEquals(
      formatAdoptedPins(adoptedPackageJsonPins(BASELINE_CONTENT, PINNED_CONTENT, PREIMAGES)),
      "react 19.3.0, zod 3.25.7",
    );
  });

  it("reports a declaration the resolver moved out of devDependencies as a move", () => {
    // `applyResolvedPins` writes `nextDeps[name]` and deletes `nextDevDeps[name]`
    // for every non-exact declaration it resolves, so the dev-only package comes
    // back as a production dependency. The published preimages are the merged
    // declaration map, so they cannot show the move - only the sections can.
    const baseline = apiWrite({
      name: "demo",
      dependencies: { react: "19.3.0" },
      devDependencies: { zod: "^3.25.0" },
    });
    const remote = apiWrite({
      name: "demo",
      dependencies: { react: "19.3.0", zod: "3.25.7" },
      devDependencies: {},
    });
    const preimages: DependencyPreimage[] = [
      { react: "19.3.0", zod: "^3.25.0" },
      { react: "19.3.0", zod: "3.25.7" },
    ];

    assertEquals(classifyPackageJsonDrift(baseline, remote, preimages), "server-pins");
    const pins = adoptedPackageJsonPins(baseline, remote, preimages);
    assertEquals(pins, [
      {
        name: "zod",
        version: "3.25.7",
        added: false,
        sectionMove: { from: "devDependencies", to: "dependencies" },
      },
    ]);
    // The move is not an addition, but it is just as unbounded by anything the
    // user wrote, so it has to reach the same consent gate.
    assertEquals(pins.filter((pin) => pin.added), []);
    assertEquals(pinsRequiringConsent(pins), pins);
    assertEquals(
      formatAdoptedPins(pins),
      "zod 3.25.7 (moved from devDependencies to dependencies)",
    );
  });

  it("reports a declaration the resolver moved into a section the file lacked", () => {
    // `buildPackageJsonContent` writes `dependencies` unconditionally, so a
    // manifest with only devDependencies gains the section outright.
    const baseline = apiWrite({ name: "demo", devDependencies: { zod: "^3.25.0" } });
    const remote = apiWrite({
      name: "demo",
      devDependencies: {},
      dependencies: { zod: "3.25.7" },
    });
    const preimages: DependencyPreimage[] = [{ zod: "^3.25.0" }, { zod: "3.25.7" }];

    assertEquals(classifyPackageJsonDrift(baseline, remote, preimages), "server-pins");
    assertEquals(
      pinsRequiringConsent(adoptedPackageJsonPins(baseline, remote, preimages)).map((pin) =>
        pin.sectionMove
      ),
      [{ from: "devDependencies", to: "dependencies" }],
    );
  });

  it("rejects a write that resolves a name declared in both sections", () => {
    // The API resolves such a name through the devDependencies declaration and
    // writes the result into `dependencies`, replacing the exact version the
    // user pinned there. Merging the sections hid that behind the range, which
    // defeated the "already exact" guard; comparing per section refuses it.
    const baseline = apiWrite({
      name: "demo",
      dependencies: { zod: "3.25.1" },
      devDependencies: { zod: "^3.25.0" },
    });
    const remote = apiWrite({
      name: "demo",
      dependencies: { zod: "3.25.7" },
      devDependencies: {},
    });
    assertEquals(
      classifyPackageJsonDrift(baseline, remote, [{ zod: "^3.25.0" }, { zod: "3.25.7" }]),
      "user-edit",
    );
  });

  it("adopts a tightening in a file that also declares an untouched shadowed name", () => {
    // Refusing the shadowed name only applies when the write touched it: a
    // manifest that merely contains one still reconciles its other pins.
    const baseline = apiWrite({
      name: "demo",
      dependencies: { react: "^19.2.4", zod: "3.25.1" },
      devDependencies: { zod: "3.25.1" },
    });
    const remote = apiWrite({
      name: "demo",
      dependencies: { react: "19.3.0", zod: "3.25.1" },
      devDependencies: { zod: "3.25.1" },
    });
    const preimages: DependencyPreimage[] = [
      { react: "^19.2.4", zod: "3.25.1" },
      { react: "19.3.0", zod: "3.25.1" },
    ];
    assertEquals(classifyPackageJsonDrift(baseline, remote, preimages), "server-pins");
    assertEquals(
      formatAdoptedPins(adoptedPackageJsonPins(baseline, remote, preimages)),
      "react 19.3.0",
    );
  });

  it("rejects a pin tightening with no matching preimage", () => {
    assertEquals(
      classifyPackageJsonDrift(BASELINE_CONTENT, PINNED_CONTENT, [
        { react: "^18.0.0", zod: "~3.20.0" },
      ]),
      "user-edit",
    );
    assertEquals(classifyPackageJsonDrift(BASELINE_CONTENT, PINNED_CONTENT, []), "user-edit");
  });

  it("rejects a pin tightening whose written state was never published", () => {
    assertEquals(
      classifyPackageJsonDrift(BASELINE_CONTENT, PINNED_CONTENT, [
        { react: "^19.2.4", zod: "~3.25.0" },
      ]),
      "user-edit",
    );
  });

  it("rejects a pin tightening that also carries an unrelated edit", () => {
    const remote = apiWrite({ ...PINNED_PKG, scripts: { dev: "veryfront dev --port 4000" } });
    assertEquals(classifyPackageJsonDrift(BASELINE_CONTENT, remote, PREIMAGES), "user-edit");
  });

  it("rejects a resolved version that does not satisfy the declared range", () => {
    const remote = apiWrite({ ...PINNED_PKG, dependencies: { react: "20.0.0", zod: "3.25.7" } });
    assertEquals(
      classifyPackageJsonDrift(BASELINE_CONTENT, remote, [
        { react: "^19.2.4", zod: "~3.25.0" },
        { react: "20.0.0", zod: "3.25.7" },
      ]),
      "user-edit",
    );
  });

  it("rejects a rewrite of a declaration that was already exact", () => {
    const baseline = apiWrite({ name: "demo", dependencies: { react: "19.2.4" } });
    const remote = apiWrite({ name: "demo", dependencies: { react: "19.3.0" } });
    assertEquals(
      classifyPackageJsonDrift(baseline, remote, [{ react: "19.2.4" }, { react: "19.3.0" }]),
      "user-edit",
    );
  });

  it("rejects a removed declaration", () => {
    const remote = apiWrite({ ...PINNED_PKG, dependencies: { react: "19.3.0" } });
    assertEquals(
      classifyPackageJsonDrift(BASELINE_CONTENT, remote, [
        { react: "^19.2.4", zod: "~3.25.0" },
        { react: "19.3.0" },
      ]),
      "user-edit",
    );
  });

  it("rejects an added declaration that is not an exact version", () => {
    const remote = apiWrite({
      ...PINNED_PKG,
      dependencies: { react: "19.3.0", zod: "3.25.7", clsx: "^2.1.0" },
    });
    assertEquals(
      classifyPackageJsonDrift(BASELINE_CONTENT, remote, [
        { react: "^19.2.4", zod: "~3.25.0" },
        { react: "19.3.0", zod: "3.25.7", clsx: "^2.1.0" },
      ]),
      "user-edit",
    );
  });

  it("rejects a key-order-only difference", () => {
    const remote = apiWrite({
      private: true,
      name: "demo",
      dependencies: { zod: "~3.25.0", react: "^19.2.4" },
      scripts: { dev: "veryfront dev" },
    });
    assertEquals(classifyPackageJsonDrift(BASELINE_CONTENT, remote, PREIMAGES), "user-edit");
  });

  it("rejects remote bytes the API writer would not have produced", () => {
    const remote = `${JSON.stringify(PINNED_PKG, null, 4)}\n`;
    assertEquals(classifyPackageJsonDrift(BASELINE_CONTENT, remote, PREIMAGES), "user-edit");
  });

  it("rejects remote bytes without the writer's trailing newline", () => {
    const remote = JSON.stringify(PINNED_PKG, null, 2);
    assertEquals(classifyPackageJsonDrift(BASELINE_CONTENT, remote, PREIMAGES), "user-edit");
  });

  it("rejects a composite range it cannot evaluate", () => {
    const baseline = apiWrite({ name: "demo", dependencies: { react: ">=19.2.4 <20" } });
    const remote = apiWrite({ name: "demo", dependencies: { react: "19.3.0" } });
    assertEquals(
      classifyPackageJsonDrift(baseline, remote, [
        { react: ">=19.2.4 <20" },
        { react: "19.3.0" },
      ]),
      "user-edit",
    );
  });

  it("rejects content that is not a JSON object", () => {
    assertEquals(classifyPackageJsonDrift("not json", PINNED_CONTENT, PREIMAGES), "user-edit");
    assertEquals(classifyPackageJsonDrift(BASELINE_CONTENT, "[]\n", PREIMAGES), "user-edit");
  });

  it("rejects a dependency section that is not a flat string map", () => {
    const baseline = apiWrite({ name: "demo", dependencies: { react: { version: "19" } } });
    const remote = apiWrite({ name: "demo", dependencies: { react: "19.3.0" } });
    assertEquals(classifyPackageJsonDrift(baseline, remote, [{ react: "19.3.0" }]), "user-edit");
  });

  it("reports no adopted pins for a user edit", () => {
    assertEquals(adoptedPackageJsonPins(BASELINE_CONTENT, PINNED_CONTENT, []), []);
  });

  it("marks a tightening of a locally declared range as not added", () => {
    assertEquals(adoptedPackageJsonPins(BASELINE_CONTENT, PINNED_CONTENT, PREIMAGES), [
      { name: "react", version: "19.3.0", added: false, sectionMove: null },
      { name: "zod", version: "3.25.7", added: false, sectionMove: null },
    ]);
    assertEquals(
      adoptedPackageJsonPins(BASELINE_CONTENT, PINNED_CONTENT, PREIMAGES)
        .filter((pin) => pin.added),
      [],
    );
    assertEquals(
      pinsRequiringConsent(adoptedPackageJsonPins(BASELINE_CONTENT, PINNED_CONTENT, PREIMAGES)),
      [],
    );
  });

  it("flags a declaration the resolver added, which the local manifest never had", () => {
    // The API writes `nextDeps[name]` for any resolved specifier the manifest
    // does not declare, so an addition is a real pin write - but the name and
    // the version are both remote, so the caller has to ask before adopting it.
    const remote = apiWrite({
      ...PINNED_PKG,
      dependencies: { clsx: "2.1.1", react: "19.3.0", zod: "3.25.7" },
    });
    const preimages: DependencyPreimage[] = [
      { react: "^19.2.4", zod: "~3.25.0" },
      { clsx: "2.1.1", react: "19.3.0", zod: "3.25.7" },
    ];
    assertEquals(classifyPackageJsonDrift(BASELINE_CONTENT, remote, preimages), "server-pins");
    assertEquals(
      adoptedPackageJsonPins(BASELINE_CONTENT, remote, preimages).filter((pin) => pin.added),
      [{ name: "clsx", version: "2.1.1", added: true, sectionMove: null }],
    );
    assertEquals(
      formatAdoptedPins(adoptedPackageJsonPins(BASELINE_CONTENT, remote, preimages)),
      "clsx 2.1.1 (added), react 19.3.0, zod 3.25.7",
    );
  });
});
