import { tool } from "veryfront/tool";
import { z } from "zod";
import { createLead, formatLeadName } from "../../lib/salesforce-client.ts";

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
    status: z.string().optional().describe(
      'Lead status (e.g., "Open - Not Contacted", "Working - Contacted", "Closed - Converted")',
    ),
    leadSource: z.string().optional().describe(
      'Lead source (e.g., "Web", "Phone Inquiry", "Partner Referral")',
    ),
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
  async execute({
    lastName,
    company,
    firstName,
    email,
    phone,
    mobilePhone,
    title,
    status,
    leadSource,
    industry,
    street,
    city,
    state,
    postalCode,
    country,
    website,
    description,
    rating,
  }) {
    const leadData: Record<string, any> = {
      LastName: lastName,
      Company: company,
    };

    if (firstName) leadData.FirstName = firstName;
    if (email) leadData.Email = email;
    if (phone) leadData.Phone = phone;
    if (mobilePhone) leadData.MobilePhone = mobilePhone;
    if (title) leadData.Title = title;
    if (status) leadData.Status = status;
    if (leadSource) leadData.LeadSource = leadSource;
    if (industry) leadData.Industry = industry;
    if (street) leadData.Street = street;
    if (city) leadData.City = city;
    if (state) leadData.State = state;
    if (postalCode) leadData.PostalCode = postalCode;
    if (country) leadData.Country = country;
    if (website) leadData.Website = website;
    if (description) leadData.Description = description;
    if (rating) leadData.Rating = rating;

    const result = await createLead(leadData);

    if (!result.success) {
      throw new Error(`Failed to create lead: ${JSON.stringify(result.errors)}`);
    }

    // Create a minimal lead object for formatting the name
    const lead = {
      FirstName: firstName,
      LastName: lastName,
      Email: email,
    } as any;

    return {
      id: result.id,
      name: formatLeadName(lead),
      lastName,
      firstName,
      company,
      email,
      phone,
      title,
      status: status || "Open - Not Contacted",
      message: `Successfully created lead: ${formatLeadName(lead)} at ${company}`,
    };
  },
});
