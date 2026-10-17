import { resolve, toFileUrl } from "#std/path";
/** Apply the pinned companion API event definitions without replacing the newer base contract. */
export async function generateRunsTaskInputContract(
  source: URL,
  directory = new URL("../src/runs/contract/", import.meta.url),
): Promise<void> {
  const pin = JSON.parse(
    await Deno.readTextFile(new URL("pin.json", directory)),
  );
  const bytes = await Deno.readFile(source);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== pin.taskInputEvents.sourceSha256) {
    throw new Error("Task input source hash mismatch");
  }
  const upstream = JSON.parse(new TextDecoder().decode(bytes));
  const documentUrl = new URL("openapi.target.json", directory);
  const document = JSON.parse(await Deno.readTextFile(documentUrl));
  const eventTypes = [
    "AGENT_RUN_TASK_INPUT_ACCEPTED",
    "AGENT_RUN_TASK_INPUT_ADMITTED",
  ];
  for (const eventType of eventTypes) {
    const payload = upstream["x-event-payloads"][eventType];
    const readPayload = upstream["x-event-read-payloads"][eventType];
    document["x-event-payloads"][eventType] = payload;
    document["x-event-read-payloads"][eventType] = readPayload;
    const name = payload.$ref.split("/").at(-1);
    for (const schemaName of [name, `${name}Redacted`]) {
      document.components.schemas[schemaName] =
        upstream.components.schemas[schemaName];
    }
    for (const schemaName of ["RunEvent", "RunSnapshotEvent"]) {
      const variants = document.components.schemas[schemaName].oneOf;
      const hasType = (
        variant: { properties: { event_type: { enum?: string[] } } },
      ) => variant.properties.event_type.enum?.includes(eventType);
      if (!variants.some(hasType)) {
        // Keep the newer base envelope; copy the upstream event's discriminant and payload exactly.
        const template = variants.find((
          variant: { properties: { event_type: { enum?: string[] } } },
        ) =>
          variant.properties.event_type.enum?.includes(
            "AGENT_RUN_AUTHORIZATION_SEALED",
          )
        );
        const upstreamVariant = upstream.components.schemas[schemaName].oneOf
          .find(hasType);
        const variant = structuredClone(template);
        variant.properties.event_type = upstreamVariant.properties.event_type;
        variant.properties.payload = upstreamVariant.properties.payload;
        const fallbackIndex = variants.findIndex((
          entry: { properties: { event_type: { not?: unknown } } },
        ) => entry.properties.event_type.not);
        variants.splice(fallbackIndex, 0, variant);
      }
      const fallback = variants.find((
        entry: { properties: { event_type: { not?: unknown } } },
      ) => entry.properties.event_type.not);
      if (!fallback.properties.event_type.not.enum.includes(eventType)) {
        fallback.properties.event_type.not.enum.push(eventType);
      }
    }
  }
  await Deno.writeTextFile(
    documentUrl,
    JSON.stringify(document, null, 2) + "\n",
  );
}

if (import.meta.main) {
  if (!Deno.args[0]) {
    throw new Error("Pass the pinned companion API OpenAPI file");
  }
  await generateRunsTaskInputContract(toFileUrl(resolve(Deno.args[0])));
}
