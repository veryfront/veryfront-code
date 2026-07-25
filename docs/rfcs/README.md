# RFCs

Design proposals for changes that are large, cross-cutting, or need discussion
before implementation. An RFC captures the problem, the design, the alternatives
considered, and the open questions — it is a request for comment, not a spec of
current behaviour.

Architecture pages in [docs/architecture/](../architecture/) describe how
Veryfront works **today**; RFCs describe changes we are **proposing**. When an
RFC lands, its accepted design graduates into the architecture/guide docs and the
RFC is marked `Status: Accepted` (or `Superseded` / `Rejected`).

## Index

| RFC | Title | Status |
| --- | ----- | ------ |
| [0001](./0001-ui-primitive-adapters.md) | Bring-your-own UI primitive adapters | Draft |

## Writing an RFC

- Number sequentially: `NNNN-kebab-title.md`.
- Open with the metadata table (Status, Author, Created, Branch, Affects).
- Lead with a one-paragraph Summary a reader can act on.
- Prefer concrete file paths, real code seams, and quoted current behaviour over
  abstractions.
- Always include: Goals/Non-goals, Alternatives considered, Risks, Open questions.
