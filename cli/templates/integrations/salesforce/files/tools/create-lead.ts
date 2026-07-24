import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createLead, formatLeadName } from "../lib/salesforce-client.ts";

type Output = {
  id: string;
  name: string;
  lastName: string;
  firstName?: string;
  company: string;
  email?: string;
  phone?: string;
  title?: string;
  status: string;
  message: string;
};

export default tool({
  id: "salesforce-create-lead",
  description:
    "Create a new lead in Salesforce CRM. LastName and Company are required, other fields are optional.",
  inputSchema: defineSchema((v) => v.object({
    lastName: v.string().describe("Last name (required)"),
    company: v.string().describe("Company name (required)"),
    firstName: v.string().optional().describe("First name"),
    email: v.string().email().optional().describe("Email address"),
    phone: v.string().optional().describe("Phone number"),
    mobilePhone: v.string().optional().describe("Mobile phone number"),
    title: v.string().optional().describe("Job title"),
    status: v
      .string()
      .optional()
      .describe(
        'Lead status (e.g., "Open - Not Contacted", "Working - Contacted", "Closed - Converted")',
      ),
    leadSource: v
      .string()
      .optional()
      .describe('Lead source (e.g., "Web", "Phone Inquiry", "Partner Referral")'),
    industry: v.string().optional().describe("Industry"),
    street: v.string().optional().describe("Street address"),
    city: v.string().optional().describe("City"),
    state: v.string().optional().describe("State/Province"),
    postalCode: v.string().optional().describe("Postal code"),
    country: v.string().optional().describe("Country"),
    website: v.string().optional().describe("Website URL"),
    description: v.string().optional().describe("Description or notes about the lead"),
    rating: v.string().optional().describe('Lead rating (e.g., "Hot", "Warm", "Cold")'),
  }))(),
  async execute(input): Promise<Output> {
    const leadData: Record<string, unknown> = {
      LastName: input.lastName,
      Company: input.company,
    };

    const optionalFields: Array<[keyof typeof input, string]> = [
      ["firstName", "FirstName"],
      ["email", "Email"],
      ["phone", "Phone"],
      ["mobilePhone", "MobilePhone"],
      ["title", "Title"],
      ["status", "Status"],
      ["leadSource", "LeadSource"],
      ["industry", "Industry"],
      ["street", "Street"],
      ["city", "City"],
      ["state", "State"],
      ["postalCode", "PostalCode"],
      ["country", "Country"],
      ["website", "Website"],
      ["description", "Description"],
      ["rating", "Rating"],
    ];

    for (const [inputKey, sfKey] of optionalFields) {
      const value = input[inputKey];
      if (value) leadData[sfKey] = value;
    }

    const result = await createLead(leadData);

    if (!result.success) {
      throw new Error(`Failed to create lead: ${JSON.stringify(result.errors)}`);
    }

    const name = formatLeadName({
      FirstName: input.firstName,
      LastName: input.lastName,
      Email: input.email,
    });

    return {
      id: result.id,
      name,
      lastName: input.lastName,
      firstName: input.firstName,
      company: input.company,
      email: input.email,
      phone: input.phone,
      title: input.title,
      status: input.status || "Open - Not Contacted",
      message: `Successfully created lead: ${name} at ${input.company}`,
    };
  },
});
