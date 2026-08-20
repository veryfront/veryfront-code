/**
 * Type-level contract for `outputSchema`.
 *
 * Every assertion lives inside a function that is never called, so nothing
 * executes; the contract is checked by `lint:test-typecheck`.
 */
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { Agent, AgentResponse } from "./types.ts";
import { agent } from "./factory.ts";

declare const temperatureSchema: Schema<{ city: string; tempC: number }>;
declare const headlineSchema: Schema<{ headline: string }>;

async function inferredFromConfiguredSchema(): Promise<void> {
  const weather = agent({ system: "You report weather.", outputSchema: temperatureSchema });
  const response = await weather.generate({ input: "Berlin?" });

  // The schema type is inferred with no annotation anywhere.
  const city: string = response.object.city;
  const tempC: number = response.object.tempC;
  // @ts-expect-error Fields outside the schema are not part of the parsed object.
  const outOfSchema = response.object.humidity;

  void city;
  void tempC;
  void outOfSchema;
}

async function unchangedWithoutSchema(): Promise<void> {
  const weather = agent({ system: "You report weather." });
  const response = await weather.generate({ input: "Berlin?" });

  const text: string = response.text;
  // @ts-expect-error Responses without an outputSchema carry no parsed object.
  const missingObject: { city: string } = response.object;

  void text;
  void missingObject;
}

async function perCallSchemaIsAccepted(): Promise<void> {
  // A per-call schema of any output type is accepted regardless of the agent's
  // configured one; the response type follows the per-call schema.
  const weather = agent({ system: "You report weather.", outputSchema: temperatureSchema });
  const response = await weather.generate({ input: "Berlin?", outputSchema: headlineSchema });

  const headline: string = response.object.headline;
  // @ts-expect-error The configured schema does not leak into override results.
  const city: string = response.object.city;

  void headline;
  void city;
}

function erasedSlotsAcceptEveryInstantiation(): void {
  const typed = agent({ system: "You report weather.", outputSchema: temperatureSchema });
  const plain = agent({ system: "You report weather." });

  const slots: Agent[] = [typed, plain];
  const byInstance = new WeakMap<Agent, string>();
  byInstance.set(typed, "typed");

  // Constructing a bare AgentResponse stays valid without an `object`.
  const legacy: AgentResponse = {
    text: "Twelve degrees.",
    messages: [],
    toolCalls: [],
    status: "completed",
  };

  void slots;
  void byInstance;
  void legacy;
}

void inferredFromConfiguredSchema;
void unchangedWithoutSchema;
void perCallSchemaIsAccepted;
void erasedSlotsAcceptEveryInstantiation;
