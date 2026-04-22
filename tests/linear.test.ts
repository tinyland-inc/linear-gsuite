import { describe, expect, it } from "vitest";
import { mapLinearIssuesToEvents } from "../src/linear.js";
import type { LinearIssuesSource } from "../src/types.js";

describe("linear issue projection", () => {
  it("filters and maps due-dated issues into all-day calendar events", () => {
    const source: LinearIssuesSource = {
      id: "business-ops",
      type: "linear-issues",
      apiKeyEnv: "LINEAR_API_KEY",
      assignee: "me",
      teamKey: "TIN",
      dueWithinDays: 30
    };

    const events = mapLinearIssuesToEvents(
      source,
      {
        id: "viewer-1",
        email: "jess@tinyland.dev",
        displayName: "Jess Sullivan",
        name: "Jess"
      },
      [
        {
          id: "issue-1",
          identifier: "TIN-372",
          title: "Follow up on past-due invoice",
          url: "https://linear.app/tinyland/issue/TIN-372",
          dueDate: "2026-04-22",
          priority: 1,
          description: "Need to send the follow-up email today.",
          teamKey: "TIN",
          teamName: "Tinyland",
          projectName: "Business Operations — Tinyland, Inc.",
          assigneeId: "viewer-1",
          assigneeEmail: "jess@tinyland.dev",
          assigneeDisplayName: "Jess Sullivan",
          assigneeName: "Jess",
          stateName: "In Progress",
          stateType: "started",
          labelNames: ["revenue", "accounts-receivable"]
        },
        {
          id: "issue-2",
          identifier: "TIN-999",
          title: "Completed item should disappear",
          url: "https://linear.app/tinyland/issue/TIN-999",
          dueDate: "2026-04-23",
          priority: 2,
          description: "",
          teamKey: "TIN",
          teamName: "Tinyland",
          projectName: "Business Operations — Tinyland, Inc.",
          assigneeId: "viewer-1",
          assigneeEmail: "jess@tinyland.dev",
          assigneeDisplayName: "Jess Sullivan",
          assigneeName: "Jess",
          stateName: "Done",
          stateType: "completed",
          labelNames: []
        }
      ]
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("TIN-372");
    expect(events[0]?.timeKind).toBe("allDay");
    expect(events[0]?.start).toBe("2026-04-22");
    expect(events[0]?.end).toBe("2026-04-23");
    expect(events[0]?.summary).toContain("TIN-372");
  });
});
