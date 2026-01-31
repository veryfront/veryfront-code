import { tool } from "veryfront/tool";
import { z } from "zod";
import { getIssue, listEvents } from "../../lib/sentry-client.ts";

export default tool({
  id: "get-issue",
  description:
    "Get detailed information about a specific Sentry issue including error details, stack traces, and recent events. Use this to investigate and debug specific errors.",
  inputSchema: z.object({
    issueId: z.string().describe("The ID of the issue to retrieve"),
    includeEvents: z
      .boolean()
      .default(true)
      .describe("Whether to include recent events for this issue"),
    eventLimit: z
      .number()
      .min(1)
      .max(50)
      .default(5)
      .describe("Number of recent events to include (1-50)"),
  }),
  async execute({ issueId, includeEvents, eventLimit }) {
    const issue = await getIssue(issueId);

    const events = includeEvents ? await listEvents(issueId, eventLimit) : [];

    return {
      issue: {
        id: issue.id,
        shortId: issue.shortId,
        title: issue.title,
        culprit: issue.culprit,
        permalink: issue.permalink,
        logger: issue.logger,
        level: issue.level,
        status: issue.status,
        substatus: issue.substatus,
        platform: issue.platform,
        project: {
          id: issue.project.id,
          name: issue.project.name,
          slug: issue.project.slug,
          platform: issue.project.platform,
        },
        type: issue.type,
        metadata: issue.metadata,
        count: issue.count,
        userCount: issue.userCount,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
        numComments: issue.numComments,
        isBookmarked: issue.isBookmarked,
        isSubscribed: issue.isSubscribed,
        assignedTo: issue.assignedTo,
        stats: issue.stats,
      },
      events: events.map((event) => ({
        id: event.id,
        eventID: event.eventID,
        message: event.message,
        platform: event.platform,
        dateCreated: event.dateCreated,
        user: event.user,
        tags: event.tags,
        contexts: event.contexts,
        entries: event.entries,
      })),
    };
  },
});
