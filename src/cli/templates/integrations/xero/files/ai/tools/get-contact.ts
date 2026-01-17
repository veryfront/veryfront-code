import { tool } from "veryfront/tool";
import { z } from "zod";
import { getContact } from "../../lib/xero-client.ts";

export default tool({
  id: "get-contact",
  description: "Get details of a specific Xero contact by its ID.",
  inputSchema: z.object({
    contactId: z.string().describe("The ID of the contact to retrieve"),
  }),
  async execute({ contactId }) {
    const contact = await getContact(contactId);

    return {
      contactId: contact.ContactID,
      contactNumber: contact.ContactNumber,
      name: contact.Name,
      firstName: contact.FirstName,
      lastName: contact.LastName,
      emailAddress: contact.EmailAddress,
      isCustomer: contact.IsCustomer,
      isSupplier: contact.IsSupplier,
      addresses: contact.Addresses?.map((addr) => ({
        addressType: addr.AddressType,
        city: addr.City,
        region: addr.Region,
        postalCode: addr.PostalCode,
        country: addr.Country,
        attentionTo: addr.AttentionTo,
      })),
      phones: contact.Phones?.map((phone) => ({
        phoneType: phone.PhoneType,
        phoneNumber: phone.PhoneNumber,
        phoneAreaCode: phone.PhoneAreaCode,
        phoneCountryCode: phone.PhoneCountryCode,
      })),
      updatedDateUTC: contact.UpdatedDateUTC,
    };
  },
});
