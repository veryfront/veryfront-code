# Sheets request examples

These wholly synthetic examples test the published request contracts. They contain no live requests, run records, or account data. Passing them proves schema acceptance and rejection, not a working integration or agent.

Connected verification is tracked separately. It found that the original agent still fails chart creation and can omit strict validation; this PR does not claim that agent is verified.

Typed contracts cover find/rename/basic-chart/validation tasks. Other existing Google chart kinds remain provider pass-throughs and are not claimed as verified.

References: [Sheets requests](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request), [chart schemas](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/charts), [Google function declaration](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/Shared.Types/FunctionDeclaration).
