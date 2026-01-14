import { type AgentBuilderFormValues } from "@/features/agent-builder/ui/AgentBuilder"

export function createAgentPrompt(values: AgentBuilderFormValues) {
  const integrationsList =
    values.integrations.length > 0 ? values.integrations.join(", ") : null

  return `[INITIAL MESSAGE]
# Agent Configuration Task

Configure this project with the following settings:

| Setting | Value |
|---------|-------|
| Name | ${values.name} |
| System Message | ${values.prompt} |
| Model | ${values.model} |
| Integrations | ${integrationsList ?? "None"} |

---

## Execution Steps

Execute each step sequentially. Do not proceed until the current step is verified complete.

### STEP 1: Update Project Config
**File:** \`veryfront.json\`
**Actions:**
1. Set \`name\` to "${values.name}"
2. Write a one-line \`description\` based on the name and system message
3. Add integrations to array: ${JSON.stringify(values.integrations)}
**Verify:** All three fields are set correctly

### STEP 2: Set System Message
**File:** \`ai/prompts/system.ts\`
**Actions:**
1. Replace the system message content with: "${values.prompt}"
**Verify:** System message matches the provided value

### STEP 3: Configure AI Model
**File:** \`api/chat.ts\`
**Actions:**
1. Based on the model selection (${values.model}), import the appropriate model/tools helpers from \`ai/models\` and \`ai/tools\`, e.g.:
   \`\`\`typescript
   import { getAnthropicModel } from "../ai/models/anthropic"
   import { getAnthropicTools } from "../ai/tools/anthropic"
   \`\`\`
2. Apply the model and tools to the \`streamText\` config
3. Use \`form_input\` tool to request the API key from user
4. Use \`set_environment_variable\` tool to save the key to preview and production environments
**Verify:** Model imports present, streamText configured, API key saved

${
  integrationsList
    ? `### STEP 4: Configure Integrations
**Integrations:** ${integrationsList}

For EACH integration, complete ALL sub-steps before moving to the next integration:

1. Call \`get_integration\` tool to fetch configuration requirements
2. For each required env var/config:
   - Call \`form_input\` tool to request value from user
   - Wait for user response before continuing
3. Create tool file at \`ai/tools/{integration_name}.ts\`
4. Update \`api/chat.ts\`:
   - Add import for the new tool
   - Add tool to the tools object in \`streamText\`
5. Call \`set_environment_variable\` for each collected value

**Verify:** Each integration has a tool file AND is wired into the chat handler`
    : `### STEP 4: Skip
No integrations configured.`
}

### STEP 5: Update Suggestions
**File:** \`veryfront.json\`
**Actions:**
${
  integrationsList
    ? `1. Create 4 discrete, short actionable suggestions (tasks) to improve efficiency based on the system message and tasks set in Step 2, plus integrations in Step 4
2. Format: \`{ title: string, prompt: string, icon: string }\`
3. Icon URL: \`https://api.veryfront.com/integrations/${values.integrations.join(",")}/icon\`
4. Update the suggestions config array`
    : `1. Create 4 discrete, short actionable suggestions (tasks) to improve efficiency based on the system message and tasks set in Step 2
2. Format: \`{ title: string, prompt: string, icon: string }\`
3. Icon URL: Use an appropriate integration icon URL if relevant, or omit
4. Update the suggestions config array`
}
**Verify:** 4 relevant suggestions are defined with icon URLs

### STEP 6: Final Verification
Confirm ALL of the following before reporting completion:
- [ ] \`veryfront.json\` has name + description + 4 suggestions
- [ ] \`veryfront.json\` contains the integrations array
- [ ] \`ai/prompts/system.ts\` contains the system message
- [ ] \`api/chat.ts\` imports and uses the correct model
- [ ] \`api/chat.ts\` has all integration tools in the tools object
- [ ] All environment variables are set

---

## Rules
- KEEP STEPS TO YOURSELF, communicate changes only (concisely)
- NEVER skip a step
- NEVER assume env var values—always prompt the user
- ALWAYS place tool files in \`ai/tools/\`
- ALWAYS wire tools into the chat handler—creating the file is not enough
- If a step fails, STOP and report the error with details
`
}

export function createAgentPromptNoTools(values: AgentBuilderFormValues) {
  const integrationsList =
    values.integrations.length > 0 ? values.integrations.join(", ") : null

  return `[INITIAL MESSAGE]
# Agent Configuration Task

Configure this project with the following settings:

| Setting | Value |
|---------|-------|
| Name | ${values.name} |
| System Message | ${values.prompt} |
| Model | ${values.model} |
| Integrations | ${integrationsList ?? "None"} |

---

## Execution Steps

Execute each step sequentially. Do not proceed until the current step is verified complete.

### STEP 1: Update Project Config
**File:** \`veryfront.json\`
**Actions:**
1. Set \`name\` to "${values.name}"
2. Write a one-line \`description\` based on the name and system message
3. Add integrations to array: ${JSON.stringify(values.integrations)}
**Verify:** All three fields are set correctly

### STEP 2: Set System Message
**File:** \`ai/prompts/system.ts\`
**Actions:**
1. Replace the system message content with: "${values.prompt}"
**Verify:** System message matches the provided value

### STEP 3: Configure AI Model
**File:** \`api/chat.ts\`
**Actions:**
1. Based on the model selection (${values.model}), import the appropriate model/tools helpers from \`ai/models\` and \`ai/tools\`, e.g.:
   \`\`\`typescript
   import { getAnthropicModel } from "../ai/models/anthropic"
   import { getAnthropicTools } from "../ai/tools/anthropic"
   \`\`\`
2. Apply the model and tools to the \`streamText\` config
3. Use \`form_input\` tool to request the API key from user
4. Use \`set_environment_variable\` tool to save the key to preview and production environments
**Verify:** Model imports present, streamText configured, API key saved

${
  integrationsList
    ? `### STEP 4: Configure Integrations
**Integrations:** ${integrationsList}

For EACH integration, complete ALL sub-steps before moving to the next integration:

1. Call \`get_integration\` tool to fetch configuration requirements
2. For each required env var/config:
   - Call \`form_input\` tool to request value from user
   - Wait for user response before continuing
3. Call \`set_environment_variable\` for each collected value`
    : `### STEP 4: Skip
No integrations configured.`
}

### STEP 5: Update Suggestions
**File:** \`veryfront.json\`
**Actions:**
${
  integrationsList
    ? `1. Create 4 discrete, short actionable suggestions (tasks) to improve efficiency based on the system message and tasks set in Step 2, plus integrations in Step 4
2. Format: \`{ title: string, prompt: string, icon: string }\`
3. Icon URL: \`https://api.veryfront.com/integrations/${values.integrations.join(",")}/icon\`
4. Update the suggestions config array`
    : `1. Create 4 discrete, short actionable suggestions (tasks) to improve efficiency based on the system message and tasks set in Step 2
2. Format: \`{ title: string, prompt: string, icon: string }\`
3. Icon URL: Use an appropriate integration icon URL if relevant, or omit
4. Update the suggestions config array`
}
**Verify:** 4 relevant suggestions are defined with icon URLs

### STEP 6: Final Verification
Confirm ALL of the following before reporting completion:
- [ ] \`veryfront.json\` has name + description + 4 suggestions
- [ ] \`veryfront.json\` contains the integrations array
- [ ] \`ai/prompts/system.ts\` contains the system message
- [ ] \`api/chat.ts\` imports and uses the correct model
- [ ] All environment variables are set

---

## Rules
- KEEP STEPS TO YOURSELF, communicate changes only (concisely)
- NEVER skip a step
- NEVER assume env var values—always prompt the user
- If a step fails, STOP and report the error with details
`
}
