import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { createContact, formatContactName } from "../../lib/hubspot-client.ts";

export default tool({
  id: "create-contact",
  description: "Create a new contact in HubSpot CRM. Email is required, other fields are optional.",
  inputSchema: defineSchema((v) => v.object({
    email: v.string().email().describe("Contact email address (required)"),
    firstname: v.string().optional().describe("First name"),
    lastname: v.string().optional().describe("Last name"),
    phone: v.string().optional().describe("Phone number"),
    company: v.string().optional().describe("Company name"),
    jobtitle: v.string().optional().describe("Job title"),
    website: v.string().optional().describe("Website URL"),
  }))(),
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
