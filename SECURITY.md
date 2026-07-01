# Security Policy

Veryfront takes the security of our framework, core, and published extensions seriously. This document explains how to report a vulnerability, what we cover, and how we respond.

## Reporting a Vulnerability

**Email:** `security@veryfront.com`

Please **do not** open a public issue for security concerns. Email the details directly. We aim to acknowledge within **48 hours** and provide an initial assessment within **5 business days**.

If you require encrypted communication, request our PGP key at the same address. We will respond with a current key fingerprint over a separate channel.

### What to include

- A description of the vulnerability and its impact
- Steps to reproduce (a minimal repro is ideal: code, manifest, command-line)
- Affected version(s): `deno.json` version field or commit SHA
- Whether you have already disclosed elsewhere (CVE, advisory, vendor)

### Embargo and disclosure

- We treat reports as embargoed until either a fix ships or 90 days pass, whichever is sooner.
- We will keep you informed of remediation progress and credit you in the advisory unless you prefer otherwise.

## Supported Versions

| Version                | Status                            |
| ---------------------- | --------------------------------- |
| `0.1.x` (latest minor) | Active, receives security patches |
| `< 0.1.<latest>`       | End of life, please upgrade       |

Pin a recent `0.1.x` release. Versions older than the current minor receive **no** patches.

## Scope

In scope for this policy:

- The `veryfront` core (this repository: `src/`, `cli/`).
- First-party extensions published from this monorepo (`extensions/ext-*`).
- Build, release, and CI scripts (`scripts/`, `.github/workflows/`).
- The compiled binary distributed via official channels.

Out of scope (report through the usual project channels, not security@):

- Demo applications and example sites.
- Third-party plugins not in `extensions/`.
- Vulnerabilities in dependencies that are already CVE-tracked upstream. Veryfront monitors those automatically (see Supply Chain).

## Supply Chain Posture

We are working to make the framework's supply chain auditable and tamper-evident. The following describes today's reality; rolling improvements are tracked in the issue tracker.

- **SBOM:** `deno task sbom` generates a CycloneDX 1.5 SBOM (`dist/sbom.json`) from the npm and `esm.sh` imports declared in `deno.json`. Coverage of transitive dependencies is in progress.
- **Continuous scanning:** CodeQL (`security-and-quality` queries) and an `npm audit` job run weekly and on same-repository pull requests that touch `deno.json` (see `.github/workflows/codeql.yml`, `.github/workflows/security-audit.yml`). External fork pull requests do not run code-checking CI. Socket.dev is configured via `socket.yml` and reviews pull requests as a GitHub App.
- **Release publishing:** npm releases use GitHub Actions OIDC trusted publishing with npm provenance. Release jobs do not use a long-lived npm publish token.
- **Pinned dependencies:** all `npm:` and `esm.sh` imports are required to declare exact `x.y.z` versions, enforced by `scripts/lint/audit-deps.ts` (`deno task lint:deps`). Git URL and tarball imports are rejected outright.
- **Install-script suppression:** npm package assembly runs dependency installation with npm lifecycle scripts disabled.
- **Capability descriptors:** each first-party extension declares the capabilities it requires (e.g. `net`, `fs`, `env`) in its `deno.json`. These are descriptive today; runtime enforcement is on the roadmap.
- **Install-script allow-list:** native postinstall scripts are explicitly allow- or deny-listed in `deno.json`'s `allowScripts` field. Unlisted packages cannot run install hooks.
- **Reproducible builds, lockfile enforcement, automated dependency PRs, and release-artifact signing are in progress.** We will update this section as each lands; until then, do not assume any of those controls are active.

## Security Hardening Recommendations for Operators

When deploying veryfront to production:

- Verify the binary's checksum against the published `sha256` on each release page.
- Pin the binary version explicitly. Avoid `latest`.
- Limit Deno permissions to the minimum your application needs (`--allow-net=<host>` not `--allow-net`, etc.).
- Subscribe to GitHub Security Advisories on this repository for notifications.

## Changelog

Security advisories are published as GitHub Security Advisories on this repository. Each advisory includes:

- Affected versions
- CVSS v3.1 score
- A patched version reference
- Reporter credit (if requested)
