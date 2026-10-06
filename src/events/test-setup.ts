import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";
import { registerEventSchemaValidator } from "./schema-validator.ts";

registerEventSchemaValidator(createZodAdapter());
