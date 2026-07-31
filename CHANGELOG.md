# Changelog

## Unreleased

- Added progressive tool-schema loading for agents through the existing `tools` selector. `tools:
  true` keeps the authorized scoped catalog behind `tool_search`; explicit tool maps expose their
  selected schemas immediately; omitted tools expose no project catalog. A trusted host-only eager
  rollback remains operational infrastructure and is not part of the public agent API.
- Added the provider-neutral `tool_search` fallback for authorized framework tools. Search ranks exact
  names before name, description, and input-parameter substrings, returns at most five schema-free
  matches, and does not paginate or search provider-native tools.
- Added private hosted checkpoint durability for loaded-tool state. Hosted continuation requires the
  Veryfront API durable run-event contract, reapplies current authorization on restore, and keeps the
  checkpoint out of public messages and replay. Direct provider use does not require Veryfront Cloud.
