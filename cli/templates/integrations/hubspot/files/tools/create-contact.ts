import { tool } from "veryfront/tool";
import { z } from "zod";
import { createContact, formatContactName } from "../../lib/hubspot-client.ts";

export default tool({
  id: "create-contact",
  description: "Create a new contact in HubSpot CRM. Email is required, other fields are optional.",
  inputSchema: z.object({
    email: z.string().email().describe("Contact email address (required)"),
    firstname: z.string().optional().describe("First name"),
    lastname: z.string().optional().describe("Last name"),
    phone: z.string().optional().describe("Phone number"),
    company: z.string().optional().describe("Company name"),
    jobtitle: z.string().optional().describe("Job title"),
    website: z.string().optional().describe("Website URL"),
  }),
  async execute({ email, firstname, lastname, phone, company, jobtitle, website }) {
    const properties: Record<string, string> = { email };

    if (firstname) properties.firstname = firstname;
    if (lastname) properties.lastname = lastname;
    if (phone) properties.phone = phone;
    if (company) properties.company = company;
    if (jobtitle) properties.jobtitle = jobtitle;
    if (website) properties.website = website;

    const contact = await createContact(properties);
    const name = formatContactName(contact);

    return {
      id: contact.id,
      name,
      email: contact.properties.email,
      phone: contact.properties.phone,
      company: contact.properties.company,
      jobTitle: contact.properties.jobtitle,
      website: contact.properties.website,
      createdAt: contact.createdAt,
      message: `Successfully created contact: ${name}`,
    };
  },
});
