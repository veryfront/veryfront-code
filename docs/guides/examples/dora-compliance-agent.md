---
title: "Compliance Agent (DORA)"
description: "Build an end-to-end agent that reviews ICT third-party contracts against DORA Article 30 and streams a structured report with proposed clause amendments through the chat UI."
order: 92
---

Build an agent that accepts an ICT third-party services contract through
a chat UI, extracts the text, scores it against the ten mandatory
contractual provisions of the Digital Operational Resilience Act
(Regulation (EU) 2022/2554) Article 30, and streams back a structured
report. Unlike a plain rubric, each finding includes a proposed clause
amendment so the reader sees exactly which contract language needs to
change and what it should say.

> The rubric and proposed amendments in this guide are illustrative and
> are **not legal advice**. Do not rely on the agent's output for
> regulatory sign-off. See the [Disclaimer](#disclaimer) at the end of
> this guide.

## What you'll build

- A `resilience` agent that uses the `dora-rubric` skill and the
  `parseContract` tool.
- A `POST /api/uploads` route that writes uploaded files to local disk
  and returns a `fileId`.
- A `POST /api/ag-ui` route that streams the agent's responses.
- A single-page chat UI with drag-and-drop file attachment.
- A Veryfront Cloud deploy.

The example runs on Node.js 18.18+ because the contract-parsing libraries
(`pdf-parse`, `mammoth`) are Node-only.

## Prerequisites

- Node.js 18.18 or later. See [Installation](../../getting-started/installation.md).
- The Veryfront CLI installed.
- An `OPENAI_API_KEY` in your local environment. See [Providers](../providers.md)
  for other providers.

## Create the project

```bash
veryfront init dora-compliance-agent --template ai-agent
cd dora-compliance-agent
```

The `ai-agent` template scaffolds these directories:

```text
dora-compliance-agent/
  agents/
    assistant.ts
  tools/
    calculator.ts
  app/
    page.tsx
    api/
      ag-ui/
        route.ts
```

We will keep `agents/`, `tools/`, `app/`, and add `skills/` next. Delete
the scaffolded `tools/calculator.ts` - we replace it in a later section.

```bash
rm tools/calculator.ts
```

## Add the DORA rubric skill

Create `skills/dora-rubric/SKILL.md`:

```markdown
---
name: dora-rubric
description: Review an ICT third-party services contract against DORA Article 30 and return a structured JSON rubric with proposed clause amendments.
allowed_tools: parseContract
---

# DORA Article 30 rubric

You are reviewing a contract between a financial entity and an ICT
third-party service provider under the Digital Operational Resilience
Act (Regulation (EU) 2022/2554). The user will provide a `fileId`
referring to an uploaded contract. Call `parseContract` once with that
`fileId` to get the contract text.

Score the contract against each of the following ten checks. The list
mixes Art. 30(2) baseline requirements (apply to every ICT contract)
and Art. 30(3) overlay requirements (apply only to contracts for
"critical or important functions"). When you score an overlay check
(numbers 5, 6, 8, 10 below), include the sentence "applies only to
contracts for critical or important functions" in the `rationale`.

1. **Art. 30(2)(a) - Clear description of services and functions.** Is
   every ICT service explicitly defined?
2. **Art. 30(2)(b) - Locations of processing and storage.** Are
   processing and storage country locations named, with a clause
   requiring notification of changes?
3. **Art. 30(2)(c) - Availability, authenticity, integrity,
   confidentiality.** Are the four properties addressed?
4. **Art. 30(2)(d) - Data access, recovery, and return on exit.** Are
   insolvency, resolution, and discontinuation paths handled?
5. **Art. 30(3)(a) - SLAs with quantitative and qualitative targets**
   (overlay). Are SLAs measurable and tied to corrective actions?
6. **Art. 30(3)(b) - Incident reporting and material-impact
   notification** (overlay). Are reporting obligations and
   material-impact notice periods defined?
7. **Art. 30(2)(h) - Termination rights and minimum notice periods.**
   Can the financial entity terminate, and is the notice period
   defined?
8. **Art. 30(3)(f) - Exit strategy with mandatory transition period**
   (overlay). Is there a defined transition period and assistance
   obligation?
9. **Art. 30 + Art. 29 - Sub-outsourcing disclosure and flow-down.**
   Are sub-processors disclosed and bound to equivalent terms?
10. **Art. 30(3)(d)(e) - Audit, inspection, and TLPT cooperation**
    (overlay). Does the contract grant audit/inspection rights and
    require TLPT cooperation?

For each check, return:

- `article`: the cited sub-provision, e.g. `Art. 30(2)(a)`.
- `check`: a short label.
- `status`: `pass | warn | fail`.
- `evidence`: the specific clause text supporting the score, or note
  its absence.
- `rationale`: a sentence explaining the status, citing the
  sub-provision. For overlay checks, include the "applies only…"
  caveat sentence above.
- `proposed_amendment`: `null` if status is `pass`. Otherwise an
  object with `current_clause`, `suggested_text`, and `rationale`.
  The `suggested_text` MUST be prefixed with `REVIEW WITH COUNSEL:`
  and be written in the imperative ("Add a clause stating…") rather
  than as polished contract prose.

Return only valid JSON of this shape, no prose, no markdown fences:

{
"overall": "pass | warn | fail",
"findings": [
{
"article": "Art. 30(2)(a)",
"check": "Clear description of services and functions",
"status": "pass | warn | fail",
"evidence": "Section 3.1: ...",
"rationale": "...",
"proposed_amendment": {
"current_clause": "Section 3.1 currently reads: ...",
"suggested_text": "REVIEW WITH COUNSEL: Add a clause stating ...",
"rationale": "DORA Art. 30(2)(a) requires ..."
}
}
]
}

`overall` is `pass` only if every finding's status is `pass`, `fail`
if any finding is `fail`, otherwise `warn`.
```

## Add the contract-parsing tool

Install the parsers:

```bash
npm install pdf-parse mammoth
```

Create `tools/parse-contract.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { tool } from "veryfront/tool";
import { z } from "zod";
// @ts-ignore - pdf-parse ships CJS without types; consider installing community types via `npm install --save-dev @types/pdf-parse`.
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

const UPLOAD_DIR = path.resolve(".veryfront/uploads");

export default tool({
  description: "Read an uploaded contract file by fileId and return its text and media type.",
  inputSchema: z.object({
    fileId: z.string().describe("Upload id returned by POST /api/uploads"),
  }),
  execute: async ({ fileId }) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
      throw new Error(`Invalid fileId: ${fileId}`);
    }
    const filepath = path.join(UPLOAD_DIR, fileId);
    if (!filepath.startsWith(UPLOAD_DIR + path.sep)) {
      throw new Error(`Refusing to read outside upload dir: ${fileId}`);
    }

    const buffer = await fs.readFile(filepath);
    const head = buffer.subarray(0, 4).toString("binary");

    if (head.startsWith("%PDF")) {
      const result = await pdfParse(buffer);
      return { text: result.text, mediaType: "application/pdf" };
    }

    if (head.startsWith("PK")) {
      const result = await mammoth.extractRawText({ buffer });
      return {
        text: result.value,
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    }

    throw new Error("Unsupported file type - expected PDF or DOCX.");
  },
});
```

Notes for the reader:

- The filename `parse-contract.ts` produces the discovered tool id
  `parseContract`. Reference the tool that way in agent configs.
- The `fileId` regex and the `startsWith` boundary check together
  prevent path traversal - the tool refuses anything that is not a slug,
  and refuses any resolved path that escapes the upload directory.
- Detection by magic bytes (`%PDF`, `PK`) avoids trusting the MIME type
  the client sent.

## Add the agent

Remove the scaffolded assistant:

```bash
rm agents/assistant.ts
```

Create `agents/resilience.ts`:

```ts
import { agent } from "veryfront/agent";

export default agent({
  id: "resilience",
  system: [
    "You are a DORA Article 30 contract reviewer for ICT third-party services.",
    "Whenever the user sends a fileId, call the parseContract tool with that fileId before scoring.",
    "Follow the rubric in the dora-rubric skill.",
    "Respond with the JSON shape defined in that skill - no preamble, no markdown fences.",
    "When a check has status warn or fail, populate proposed_amendment with concrete draft language prefixed REVIEW WITH COUNSEL.",
  ].join(" "),
  skills: ["dora-rubric"],
  tools: { parseContract: true },
  maxSteps: 6,
});
```

The agent is named `resilience` so it does not collide with the GDPR
guide's `compliance` agent if you build both projects side by side.
`maxSteps: 6` (one higher than the GDPR variant) gives the agent
slightly more headroom because populating ten `proposed_amendment`
objects is more work per turn than the GDPR rubric.

## Add the upload API route

Create `app/api/uploads/route.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const UPLOAD_DIR = path.resolve(".veryfront/uploads");
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing file" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return Response.json(
      { error: `Unsupported type ${file.type}` },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "File too large" }, { status: 413 });
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const fileId = crypto.randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(UPLOAD_DIR, fileId), buffer);

  return Response.json({ fileId, mediaType: file.type, size: file.size });
}
```

> **Demo-only storage.** This route writes uploads to the local disk of
> whichever instance handled the request. That is fine for following
> this guide and for one-machine deploys, but it does not survive a
> multi-instance Cloud deploy without sticky routing. For a production
> upload pipeline (S3, GCS, signed URLs, virus scanning, retention), see
> a future production-storage guide.

## Add the chat route

Create or replace `app/api/ag-ui/route.ts`:

```ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("resilience");
```

This wires the chat UI in the next step to the `resilience` agent.

## Render the chat with attachment support

Replace `app/page.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { Chat, useChat } from "veryfront/chat";

type Uploaded = { id: string; name: string };

export default function Page() {
  const chat = useChat({ api: "/api/ag-ui" });
  const [uploaded, setUploaded] = useState<Uploaded[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function onAttach(files: FileList): void {
    void handleFiles(Array.from(files));
  }

  async function handleFiles(files: File[]): Promise<void> {
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/uploads", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const { error } = await response.json().catch(() => ({ error: "Upload failed" }));
        setUploadError(`${file.name}: ${error}`);
        continue;
      }
      const { fileId } = (await response.json()) as { fileId: string };
      setUploaded((prev) => [...prev, { id: fileId, name: file.name }]);
      setUploadError(null);
      await chat.sendMessage({
        text: `Review the contract with fileId="${fileId}".`,
      });
    }
  }

  return (
    <>
      {uploadError && (
        <div role="alert" style={{ color: "crimson", marginBottom: 8 }}>
          Upload error - {uploadError}
        </div>
      )}
      <Chat
        {...chat}
        onAttach={onAttach}
        attachAccept=".pdf,.docx"
        attachments={uploaded.map((file) => ({ id: file.id, name: file.name }))}
        onRemoveAttachment={(id) => setUploaded((prev) => prev.filter((file) => file.id !== id))}
        placeholder="Drop an ICT services contract to review"
      />
    </>
  );
}
```

`"use client"` is required because `useChat` is a React hook. The
`onAttach` handler fans out to an async helper that uploads each file,
then calls `chat.sendMessage` with a message containing the returned
`fileId`. The agent's system prompt tells it to call `parseContract`
whenever it sees a `fileId`. Upload failures surface as an inline alert
above the chat instead of being injected into chat history.

## Run it locally

Start the dev server:

```bash
veryfront dev
```

Open `http://localhost:3000`, drop an ICT services contract (PDF or
DOCX) into the chat composer, and wait for the streamed JSON report.

A well-formed response looks like:

```json
{
  "overall": "warn",
  "findings": [
    {
      "article": "Art. 30(2)(a)",
      "check": "Clear description of services and functions",
      "status": "pass",
      "evidence": "Section 2 lists in-scope services with unique identifiers.",
      "rationale": "Each service is named and scoped; the description satisfies Art. 30(2)(a).",
      "proposed_amendment": null
    },
    {
      "article": "Art. 30(3)(a)",
      "check": "SLAs with quantitative and qualitative targets",
      "status": "warn",
      "evidence": "Section 6 mentions SLAs but does not specify numerical thresholds.",
      "rationale": "SLAs are referenced but lack quantitative targets. This check applies only to contracts for critical or important functions.",
      "proposed_amendment": {
        "current_clause": "Section 6 currently reads: 'The Provider shall maintain industry-standard service levels.'",
        "suggested_text": "REVIEW WITH COUNSEL: Add a clause stating that the Provider shall meet specific quantitative service levels - at minimum 99.9% monthly availability, RPO of one hour, RTO of four hours, and incident response time of thirty minutes - with monthly performance reporting and a service-credit regime for missed targets.",
        "rationale": "DORA Art. 30(3)(a) requires SLAs with precise quantitative and qualitative performance targets to enable effective monitoring and timely corrective actions."
      }
    }
  ]
}
```

## Verify it worked

If the agent responds without calling `parseContract`, check that:

- `agents/resilience.ts` has `tools: { parseContract: true }`.
- `agents/resilience.ts` has `maxSteps: 6` (or higher).
- The user message includes the literal text `fileId="<uuid>"`.

If the agent emits prose instead of JSON, the model dropped the
instruction. Lower the temperature in your provider configuration, or
add an explicit "Output JSON only" reminder to the user message.

If `proposed_amendment` is missing or set to `null` on a `warn` or
`fail` finding, the agent skipped the amendment step. Add an explicit
"You MUST populate proposed_amendment when status is not pass" line to
the agent system prompt.

If the agent treats every contract as critical-or-important and applies
the overlay checks (5, 6, 8, 10) without the caveat sentence, the
rubric was not followed. Re-read the SKILL.md instructions and confirm
the file was placed at `skills/dora-rubric/SKILL.md`, not at a different
path.

## Deploy to Veryfront Cloud

Build:

```bash
veryfront build
```

Connect the project to Veryfront Studio, set `OPENAI_API_KEY` in the
Studio environment variables, then deploy:

```bash
veryfront deploy
```

Open the deployed app:

```bash
veryfront open
```

For a deeper walkthrough of the deploy flow - including preview
environments and rollback - see [Deploy a project](../../getting-started/deploy-project.md).

## Disclaimer

The rubric and the proposed clause amendments in this guide are
illustrative and **not legal advice**. The Digital Operational
Resilience Act (Regulation (EU) 2022/2554) sets minimum requirements
for ICT third-party contracts in the EU financial sector; sector-
specific overlays for banking, insurance, and crypto-asset service
provision may add further obligations. The Regulatory Technical
Standards (RTS) that flesh out Article 30 are still being finalized.
Use this agent as a draft reviewer that flags candidates for human
review, not as a regulatory sign-off tool. Every `suggested_text`
proposed by the agent must be reviewed and revised by qualified
counsel before insertion into a real contract.

## Related

- [Agents](../agents.md) - system prompts, skills, tool calls,
  hosted runs.
- [Tools](../tools.md) - write production tool contracts and
  validation.
- [Skills](../skills.md) - author `SKILL.md` files with
  allowed-tool policies.
- [Chat UI](../chat-ui.md) - preset chat component and the `useChat`
  hook.
- [Deploy a project](../../getting-started/deploy-project.md) - ship and verify a
  production deployment.
