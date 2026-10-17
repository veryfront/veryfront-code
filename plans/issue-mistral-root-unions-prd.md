# Preserve Mistral root tool schema unions

## Problem and solution

Cloud Mistral tool conversion removes exclusive root variants even though its backend accepts them.
Preserve complete root schemas for that backend through an explicit profile capability, selected only
with its authenticated OpenAI wire surface. Preserve native OpenAI normalization and tool limits.

## Implementation

1. Reproduce the captured exclusive disposition/processed schema at `convertToolsToRuntimeTools`.
2. Add the narrow cloud Mistral capability to the provider profile.
3. Bypass native OpenAI root folding only when this capability is present.
4. Cover native OpenAI, other compatible backends, schema model overrides, and the 128-tool limit.

## Verification criteria

- The captured converter test fails before implementation and passes afterward.
- `oneOf`, branch required fields, and closed properties survive conversion unchanged for Mistral.
- Native OpenAI and other OpenAI-compatible backends still fold unsupported root composition.
- Schema model overrides select the correct capability; the tool limit stays 128.
- Focused converter/profile tests, changed-file type checks and lint pass.
- Build an npm artifact using the existing build pipeline and qualify the real Mistral evaluation if
  the build environment permits it. Record any blocker without claiming the artifact was tested.

## Demo runbook

Prerequisites: a built package, a valid Veryfront cloud credential, and the controlled ingestion eval.
Critical flow: run that eval using the package with the captured Mistral model and unchanged tool schema.
Pass criteria: successful provider response, exclusive arguments, successful ingestion assertion.
Known blockers: artifact build and live qualification remain pending at implementation time.
Verified demo links: none. The controlled wire-restoration experiment is diagnosis evidence, not a
released-package demo.

## References

- [Research](issue-mistral-root-unions-research.md)
