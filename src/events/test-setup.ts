import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";
import { registerAgentEventSchemaValidator } from "./schema-validator.ts";

registerAgentEventSchemaValidator(createZodAdapter());
