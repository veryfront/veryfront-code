# Public repository hardening

Use this checklist before changing `veryfront/veryfront-code` from private to public, and repeat it after the visibility change is complete.

## GitHub settings

Verify these settings from repository settings or the GitHub REST API.

| Setting                               | Required state                         | Evidence                                                                                  |
| ------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| Code security                         | Enabled                                | `security_and_analysis.code_security.status == "enabled"`                                 |
| Secret scanning                       | Enabled                                | `security_and_analysis.secret_scanning.status == "enabled"`                               |
| Secret scanning non-provider patterns | Enabled                                | `security_and_analysis.secret_scanning_non_provider_patterns.status == "enabled"`         |
| Secret scanning AI detection          | Enabled                                | `security_and_analysis.secret_scanning_ai_detection.status == "enabled"`                  |
| Secret scanning validity checks       | Enabled                                | `security_and_analysis.secret_scanning_validity_checks.status == "enabled"`               |
| Push protection                       | Enabled                                | `security_and_analysis.secret_scanning_push_protection.status == "enabled"`               |
| Dependabot security updates           | Enabled                                | `security_and_analysis.dependabot_security_updates.status == "enabled"`                   |
| Workflow token default                | Read-only                              | `default_workflow_permissions == "read"`                                                  |
| GitHub Actions PR review approval     | Disabled                               | `can_approve_pull_request_reviews == false`                                               |
| GitHub Actions SHA pinning            | Required                               | `sha_pinning_required == true`                                                            |
| Private fork PR workflows             | Disabled                               | `run_workflows_from_fork_pull_requests == false`                                          |
| Code owner review on `main`           | Required                               | `required_pull_request_reviews.require_code_owner_reviews == true`                        |
| Private vulnerability reporting       | Enabled after the repository is public | `GET /repos/{owner}/{repo}/private-vulnerability-reporting` returns `{ "enabled": true }` |

Private vulnerability reporting is a public repository feature. If the repository is still private, verify the API again immediately after the visibility change and enable it before announcing the repository.

## Pull requests from forks

External fork pull requests must not execute code-checking CI. The repository still accepts fork pull requests, but code-executing workflows must be guarded so only push, manual, scheduled, and same-repository pull request events run jobs.

Required guard for code-executing pull request workflows:

```yaml
if: ${{ github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository }}
```

The CLA workflow uses `pull_request_target` so it can comment on external pull requests. It must not check out or execute contributor code.

## npm supply-chain release controls

Recent npm compromises have used maintainer account takeover, malicious pull requests, new transitive dependencies, and install-time payloads to steal CI and registry credentials. Veryfront release automation must avoid long-lived npm publish tokens and must not execute npm dependency lifecycle scripts during package assembly.

Required controls:

- Configure npm trusted publishing for package `veryfront`: GitHub Actions publisher, owner `veryfront`, repository `veryfront-code`, workflow filename `cicd.yml`, environment `production`, action `npm publish`.
- Keep `.github/workflows/cicd.yml` release jobs on `permissions: id-token: write` and publish with `npm publish --provenance --access public`.
- Do not reference `secrets.NPM_TOKEN` or `NODE_AUTH_TOKEN` in npm publish steps.
- Remove the repository or organization `NPM_TOKEN` secret after trusted publishing is configured and one dry release check confirms npm accepts OIDC authentication.
- Keep release `actions/setup-node` caching disabled.
- Keep generated npm package metadata pointed at `github.com/veryfront/veryfront-code` so npm provenance links to the publishing source.
- Keep `scripts/build/build-npm-dnt.ts` npm install calls on `--ignore-scripts`.
- Keep `deno task lint:deps` and `deno task audit` in CI.

## GitHub App release credentials

Release automation must use short-lived GitHub App installation tokens instead of user PAT secrets.

Configure these GitHub Apps before the first release after this checklist lands:

| Purpose                               | Repository access                                                            | Required permissions                  | Variables and secrets                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| Release artifacts and deploy dispatch | `veryfront`, `veryfront-server`, `veryfront-job-runner`, `veryfront-sandbox` | Contents: write                       | `VERYFRONT_RELEASE_APP_CLIENT_ID`, `VERYFRONT_RELEASE_APP_PRIVATE_KEY` |
| Docs sync                             | `veryfront-docs`                                                             | Contents: write                       | `VERYFRONT_DOCS_APP_CLIENT_ID`, `VERYFRONT_DOCS_APP_PRIVATE_KEY`       |
| Homebrew tap                          | `homebrew-tap`                                                               | Contents: write, Pull requests: write | `HOMEBREW_TAP_APP_CLIENT_ID`, `HOMEBREW_TAP_APP_PRIVATE_KEY`           |

Store app client IDs as GitHub Actions variables. Store private keys as `production` environment secrets where the workflow uses `environment: production`; use the narrowest available scope for any workflow that cannot use an environment.

After a successful dry release or equivalent workflow validation, remove the old repository secrets `GH_PAT_VERYFRONT` and `GH_PAT_HOMEBREW_TAP`.

## Validation commands

Run these checks after changing hardening files or workflows:

```bash
deno test --no-lock --no-check --allow-read src/security/repository-hardening.test.ts
deno fmt --check SECURITY.md .github/SECURITY-HARDENING.md src/security/repository-hardening.test.ts
deno test --config=scripts/test.deno.json --no-lock --no-check --allow-read \
  --filter "npm package provenance metadata points at veryfront-code" \
  scripts/build/npm-package-metadata.test.ts
deno task lint:deps
deno task audit
```
