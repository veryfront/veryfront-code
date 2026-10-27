# Calendar pagination research

## Evidence

A connected Calendar agenda query returned ten events for a two-week window, while a larger-page query returned twelve. Both list tools omit `pageToken` and transform the provider response to `items`, discarding `nextPageToken`. A successful call can therefore look complete while hiding later events.

Google documents `pageToken` for both [event pages](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) and [calendar pages](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list). A non-empty `nextPageToken` means another page exists, even when the current page has fewer entries than the requested maximum. Neither response supplies a total result count.

## Existing implementation

`templates/integrations/calendar/connector.json` owns the contract. The generated runtime catalog and tool summaries come from the connector. The standard endpoint executor already returns the full provider response when no transform is declared. Historical summary contracts retain selected collection fields and paging output fields.

`find_free_time` calls Google's independent free/busy endpoint and does not consume either list result. Repository references to the Calendar list tools are transport or message-history tests, not array-dependent production consumers. The hosted API's date handling changes request inputs, not Calendar response bodies.

## Chosen direction

Add the optional native `pageToken` query argument and return native page objects for both tools. Keep existing page-size defaults. Declare compact historical collection and pagination fields so follow-up calls retain cursor evidence. Update generated artifacts, user docs and regression tests.

This corrects the list tool result shape: consumers of the old transformed array use `items` on the returned page instead. Existing transforms on other integrations stay unchanged. Avoid a custom API wrapper, automatic fetching, synthetic totals, larger default limits or prompt instructions that hide the missing contract.
