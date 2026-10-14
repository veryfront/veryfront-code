/** Verify and inventory reviewed third-party source distributions shipped outside npm. */
import { isAbsolute, relative, resolve } from "#std/path";
import { purl } from "../lib/deno-lock.ts";
import type { CycloneDXComponent } from "./generate-sbom.ts";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Vendored source metadata must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new TypeError(
      "Vendored source metadata has missing or unexpected fields",
    );
  }
}

function text(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || value.length > 512 || !pattern.test(value)) {
    throw new TypeError("Invalid vendored source " + label);
  }
  return value;
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && !isAbsolute(path) &&
    !path.split(/[\\/]/).includes("..");
}

export async function vendorComponentsByWorkspaceManifest(
  workspaceMembers: string[],
  rootDirectory = ".",
): Promise<Record<string, CycloneDXComponent[]>> {
  const output: Record<string, CycloneDXComponent[]> = {};
  const root = await Deno.realPath(rootDirectory);
  const sourceIdentities = new Map<string, string>();
  for (const member of workspaceMembers) {
    text(member, /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/, "workspace path");
    const directory = await Deno.realPath(resolve(root, member));
    if (!inside(root, directory)) {
      throw new TypeError("Vendored workspace escapes the source root");
    }
    const inventoryPath = resolve(directory, "vendor-sources.json");
    try {
      await Deno.lstat(inventoryPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
    // A present but dangling/escaping inventory is an error, not an absent optional inventory.
    const realInventory = await Deno.realPath(inventoryPath);
    if (!inside(directory, realInventory)) {
      throw new TypeError("Vendored inventory escapes its workspace");
    }
    if ((await Deno.stat(realInventory)).size > 32768) {
      throw new TypeError("Vendored inventory exceeds its bound");
    }
    const inventoryBytes = await Deno.readFile(realInventory);
    if (inventoryBytes.length > 32768) {
      throw new TypeError("Vendored inventory exceeds its bound");
    }
    const inventory = record(
      JSON.parse(new TextDecoder().decode(inventoryBytes)),
    );
    exactKeys(inventory, ["components"]);
    if (
      !Array.isArray(inventory.components) || inventory.components.length < 1 ||
      inventory.components.length > 8
    ) {
      throw new TypeError(
        "Vendored inventory requires one to eight components",
      );
    }
    const components: CycloneDXComponent[] = [];
    const identities = new Set<string>();
    for (const raw of inventory.components) {
      const component = record(raw);
      exactKeys(component, [
        "name",
        "version",
        "source",
        "sha256",
        "license",
        "upstream",
      ]);
      const name = text(component.name, /^[a-z0-9][a-z0-9.-]*$/, "name");
      const version = text(
        component.version,
        /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/,
        "version",
      );
      const source = text(
        component.source,
        /^vendor\/[A-Za-z0-9._-]+\.js$/,
        "path",
      );
      const sha256 = text(component.sha256, /^[a-f0-9]{64}$/, "digest");
      if (component.license !== "MIT") {
        throw new TypeError("Unreviewed vendored source license");
      }
      const identity = name + "@" + version;
      if (identities.has(identity)) {
        throw new TypeError("Duplicate vendored source identity");
      }
      identities.add(identity);
      const sourcePath = await Deno.realPath(resolve(directory, source));
      if (!inside(directory, sourcePath)) {
        throw new TypeError("Vendored code escapes its workspace");
      }
      if ((await Deno.stat(sourcePath)).size > 1048576) {
        throw new TypeError("Vendored code exceeds its bound");
      }
      const bytes = await Deno.readFile(sourcePath);
      if (bytes.length > 1048576) {
        throw new TypeError("Vendored code exceeds its bound");
      }
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
      if (digest !== sha256) {
        throw new TypeError("Vendored source digest mismatch: " + source);
      }
      const upstream = record(component.upstream);
      exactKeys(upstream, ["name", "version", "source", "sha256", "url"]);
      const upstreamName = text(
        upstream.name,
        /^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/,
        "upstream name",
      );
      const upstreamVersion = text(
        upstream.version,
        /^\d+\.\d+\.\d+$/,
        "upstream version",
      );
      const upstreamSource = text(
        upstream.source,
        /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9._-]+)*$/,
        "upstream source",
      );
      const upstreamDigest = text(
        upstream.sha256,
        /^[a-f0-9]{64}$/,
        "upstream digest",
      );
      const upstreamUrl = text(
        upstream.url,
        /^https:\/\/registry\.npmjs\.org\/[^?#]+$/,
        "upstream URL",
      );
      const parsedUrl = new URL(upstreamUrl);
      if (
        parsedUrl.origin !== "https://registry.npmjs.org" ||
        parsedUrl.username || parsedUrl.password
      ) {
        throw new TypeError("Invalid vendored upstream origin");
      }
      const fingerprint = JSON.stringify([
        sha256,
        upstreamName,
        upstreamVersion,
        upstreamSource,
        upstreamDigest,
        upstreamUrl,
      ]);
      const prior = sourceIdentities.get(identity);
      if (prior !== undefined && prior !== fingerprint) {
        throw new TypeError(
          "Conflicting vendored source identity across workspaces",
        );
      }
      sourceIdentities.set(identity, fingerprint);
      components.push({
        type: "library",
        name,
        version,
        purl: "pkg:generic/" + encodeURIComponent(name) + "@" +
          encodeURIComponent(version),
        hashes: [{ alg: "SHA-256", content: digest }],
        licenses: [{ license: { id: "MIT" } }],
        pedigree: {
          ancestors: [{
            type: "library",
            name: upstreamName,
            version: upstreamVersion,
            purl: purl(upstreamName, upstreamVersion),
          }],
        },
        externalReferences: [{ type: "distribution", url: upstreamUrl }],
        properties: [
          { name: "source:path", value: member + "/" + source },
          { name: "source:upstream-path", value: upstreamSource },
          { name: "source:upstream-sha256", value: upstreamDigest },
          {
            name: "source:distribution",
            value: "reviewed source modification",
          },
        ],
      });
    }
    output[member + "/deno.json"] = components;
  }
  return output;
}
