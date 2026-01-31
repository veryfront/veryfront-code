import { tool } from "veryfront/tool";
import { z } from "zod";
import { createLead, formatLeadName } from "../../lib/salesforce-client.ts";

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
  id: "create-lead",
  description:
    "Create a new lead in Salesforce CRM. LastName and Company are required, other fields are optional.",
  inputSchema: z.object({
    lastName: z.string().describe("Last name (required)"),
    company: z.string().describe("Company name (required)"),
    firstName: z.string().optional().describe("First name"),
    email: z.string().email().optional().describe("Email address"),
    phone: z.string().optional().describe("Phone number"),
    mobilePhone: z.string().optional().describe("Mobile phone number"),
    title: z.string().optional().describe("Job title"),
    status: z
      .string()
      .optional()
      .describe(
        'Lead status (e.g., "Open - Not Contacted", "Working - Contacted", "Closed - Converted")',
      ),
    leadSource: z
      .string()
      .optional()
      .describe('Lead source (e.g., "Web", "Phone Inquiry", "Partner Referral")'),
    industry: z.string().optional().describe("Industry"),
    street: z.string().optional().describe("Street address"),
    city: z.string().optional().describe("City"),
    state: z.string().optional().describe("State/Province"),
    postalCode: z.string().optional().describe("Postal code"),
    country: z.string().optional().describe("Country"),
    website: z.string().optional().describe("Website URL"),
    description: z.string().optional().describe("Description or notes about the lead"),
    rating: z.string().optional().describe('Lead rating (e.g., "Hot", "Warm", "Cold")'),
  }),
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
