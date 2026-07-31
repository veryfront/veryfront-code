# Changelog

## Unreleased

- Added progressive tool-schema loading for agents. `toolLoading` remains optional; omitted values
  intentionally use deferred loading, while `toolLoading: "eager"` preserves the rollback path and
  exposes all authorized tool schemas up front. `tool_search` is now reserved by deferred loading;
  rename any custom tool with that name, or temporarily set `toolLoading: "eager"` while migrating.
- Added the provider-neutral `tool_search` fallback for authorized framework tools. Search ranks exact
  names before name, description, and input-parameter substrings, returns at most five schema-free
  matches, and does not paginate or search provider-native tools.
- Added private hosted checkpoint durability for loaded-tool state. Hosted continuation requires the
  Veryfront API durable run-event contract, reapplies current authorization on restore, and keeps the
  checkpoint out of public messages and replay. Direct provider use does not require Veryfront Cloud.
