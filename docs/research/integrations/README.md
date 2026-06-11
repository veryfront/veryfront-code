# Veryfront Integrations — Research & Top-70 Roadmap

Research bundle answering: _what integrations veryfront has today, what's
missing, what DACH businesses + Proton.me need, and the Top 70 target catalog
(DACH-first)._

Snapshot: 2026-06-11 · Source: `src/integrations/_data.ts`,
`src/integrations/feature-flags.ts`, `docs/guides/integrations.md`.

## Contents

1. **[00-current-integrations.md](./00-current-integrations.md)** — Inventory.
   39 shipped connectors (22 GA + 17 experimental), 474 tools, coverage by
   category, and the declared-vs-shipped gap.
2. **[01-missing-existing-integrations.md](./01-missing-existing-integrations.md)**
   — The 12 connectors _declared in code but unshipped_ (Zoom, monday, Intercom,
   Mailchimp, ClickUp, Pipedrive, Box, Freshdesk, QuickBooks, Xero, Twitter/X,
   Webex), each mapped to its public API + build difficulty.
3. **[02-dach-and-proton-integrations.md](./02-dach-and-proton-integrations.md)**
   — DACH business APIs (DATEV, Lexware Office, sevDesk, Personio, Mollie, DHL…)
   and a Proton.me reality check (no public Mail/Calendar/Drive API; only
   SimpleLogin is buildable).
4. **[03-top-70-integrations.md](./03-top-70-integrations.md)** — 🎯 The goal:
   ranked **Top 70** target catalog (1–50 global core, 51–70 DACH block) with
   status + phased execution order.
5. **[04-dach-not-implemented-deep-dive.md](./04-dach-not-implemented-deep-dive.md)**
   — Deep dive on **not-implemented DACH integrations**: e-commerce/ERP
   (Shopware, Xentral, weclapp, plentymarkets, JTL), banking/SEPA (Qonto, finAPI,
   GoCardless), logistics (Sendcloud, DHL, DPD, GLS), GDPR infra/privacy
   (Hetzner, Nextcloud, mailbox.org), and marketing/e-signature/trust (Brevo,
   CleverReach, Skribble, Trusted Shops). Each with API + connector-fit caveat.

## TL;DR

- **Today:** 39 connectors, 474 tools. Strong on Google/Microsoft/dev/PM; weak on
  video meetings, SMB CRM, accounting, marketing, and DACH/EU services.
- **Free wins:** 12 connectors are already _declared_ in code with reserved slots
  but no data — all have public APIs and are pure implementation backlog.
- **DACH gap (the focus):** none of the local stack is built — accounting (DATEV,
  Lexware, sevDesk), HR (Personio, Factorial), e-commerce/ERP (Shopware, Xentral,
  weclapp, plentymarkets, JTL), SEPA/open banking (finAPI, GoCardless, Qonto),
  logistics (Sendcloud, DHL, DPD, GLS), GDPR infra/privacy (Hetzner, Nextcloud,
  mailbox.org), e-signature/trust (Skribble, Trusted Shops). Shopware + Personio +
  Lexware/sevDesk + Qonto + Sendcloud + Brevo are the highest-leverage first wins.
- **Proton:** no public REST API for Mail/Calendar/Drive (10+ year community ask).
  Only **SimpleLogin** (Proton-owned) has a real API — ship that; offer a Proton
  Mail **Bridge** (IMAP/SMTP) recipe for self-hosters; do not build on the
  reverse-engineered `go-proton-api`. **mailbox.org** is the buildable DE privacy
  alternative (CalDAV/IMAP recipe).
- **To reach the Top 70:** build **36 net-new** connectors (10 declared + 6
  global/EU new + 20 DACH). 34 of the 39 shipped already make the Top 70.
