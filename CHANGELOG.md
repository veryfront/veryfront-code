# Changelog

## Unreleased

- Added progressive tool-schema loading for agents. `toolLoading` remains optional; omitted values
  intentionally use deferred loading, while `toolLoading: "eager"` preserves the rollback path and
  exposes all authorized tool schemas up front. `tool_search` is now reserved by deferred loading;
  rename any custom tool with that name, or temporarily set `toolLoading: "eager"` while migrating.
