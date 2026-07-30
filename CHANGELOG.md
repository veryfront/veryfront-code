# Changelog

## Unreleased

- Added progressive tool-schema loading for agents. `toolLoading` remains optional; omitted values
  intentionally use deferred loading, while `toolLoading: "eager"` preserves the rollback path and
  exposes all authorized tool schemas up front.
