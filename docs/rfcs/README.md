# Veryfront RFCs

This folder holds proposed target-state designs, API shape discussions, and
migration records. RFCs are not current-state architecture documentation.

An RFC may describe behavior that is not implemented yet, but public contract
sections must still be specific enough to review: option shapes, return values,
DOM semantics, compatibility impact, security defaults, and migration risk
belong in the RFC or in its breaking-change ledger. Do not use `TBD` in public
contract tables.

Architecture pages in [docs/architecture/](../architecture/) describe how
Veryfront works today. Move accepted current-state implementation details into
architecture or guide docs only after the corresponding code exists.

## Index

| RFC                                     | Title                                | Status |
| --------------------------------------- | ------------------------------------ | ------ |
| [0001](./0001-ui-primitive-adapters.md) | Bring-your-own UI primitive adapters | Draft  |
| [0029](./29-chat-api-shape.md)          | Chat API shape                       | Draft  |
| [0030](./0030-salesforce-case-triage-template.md) | Salesforce Case Triage: a fork-and-run integration template | Draft  |

## Writing an RFC

- Number sequentially: `NNNN-kebab-title.md`.
- Open with the metadata table (Status, Author, Created, Branch, Affects).
- Lead with a one-paragraph summary a reader can act on.
- Prefer concrete file paths, real code boundaries, and quoted current behavior
  over abstractions.
- Include goals, non-goals, alternatives considered, risks, and open questions.
