import { Effect } from "effect";
import type {
  LinearIssueStateType,
  LinearIssuesSource,
  ReminderOverrides,
  ResolvedCalendarEvent
} from "./types.js";
import {
  effectPromise,
  fail,
  formatEnvironmentRequirementStatus,
  hydrateEnvironmentRequirement,
  inspectEnvironmentRequirement
} from "./utils.js";

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";
const DEFAULT_LINEAR_REMINDERS: ReminderOverrides = {
  email: 1440,
  popup: 60
};
const DEFAULT_EXCLUDED_STATE_TYPES = new Set<LinearIssueStateType>(["completed", "canceled"]);

interface LinearViewer {
  id: string;
  email: string;
  displayName: string;
  name: string;
}

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  url: string;
  dueDate: string;
  priority: number;
  description: string;
  teamKey: string;
  teamName: string;
  projectName: string;
  assigneeId: string;
  assigneeEmail: string;
  assigneeDisplayName: string;
  assigneeName: string;
  stateName: string;
  stateType: LinearIssueStateType;
  labelNames: string[];
}

interface LinearPage {
  viewer: LinearViewer;
  issues: LinearIssueNode[];
  hasNextPage: boolean;
  endCursor: string;
}

const LINEAR_ISSUES_QUERY = `
query LinearGsuiteIssues($after: String) {
  viewer {
    id
    email
    displayName
    name
  }
  issues(first: 250, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      identifier
      title
      url
      dueDate
      priority
      description
      team {
        key
        name
      }
      project {
        name
      }
      assignee {
        id
        email
        displayName
        name
      }
      state {
        name
        type
      }
      labels(first: 20) {
        nodes {
          name
        }
      }
    }
  }
}
`;

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw fail(`Expected object for ${field}`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw fail(`Expected string for ${field}`);
  return value;
}

function asOptionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) throw fail(`Expected number for ${field}`);
  return value;
}

function normalizeStateType(value: unknown): LinearIssueStateType {
  switch (value) {
    case "triage":
    case "backlog":
    case "unstarted":
    case "started":
    case "completed":
    case "canceled":
      return value;
    default:
      return "unknown";
  }
}

function normalizeViewer(raw: unknown): LinearViewer {
  const record = asRecord(raw, "viewer");
  return {
    id: asOptionalString(record.id),
    email: asOptionalString(record.email),
    displayName: asOptionalString(record.displayName),
    name: asOptionalString(record.name)
  };
}

function normalizeIssueNode(raw: unknown, field: string): LinearIssueNode {
  const record = asRecord(raw, field);
  const team = record.team ? asRecord(record.team, `${field}.team`) : {};
  const project = record.project ? asRecord(record.project, `${field}.project`) : {};
  const assignee = record.assignee ? asRecord(record.assignee, `${field}.assignee`) : {};
  const state = record.state ? asRecord(record.state, `${field}.state`) : {};
  const labels = record.labels ? asRecord(record.labels, `${field}.labels`) : {};
  const labelNodes = Array.isArray(labels.nodes) ? labels.nodes : [];

  return {
    id: asString(record.id, `${field}.id`),
    identifier: asString(record.identifier, `${field}.identifier`),
    title: asString(record.title, `${field}.title`),
    url: asOptionalString(record.url),
    dueDate: asOptionalString(record.dueDate),
    priority: asNumber(record.priority, `${field}.priority`),
    description: asOptionalString(record.description),
    teamKey: asOptionalString(team.key),
    teamName: asOptionalString(team.name),
    projectName: asOptionalString(project.name),
    assigneeId: asOptionalString(assignee.id),
    assigneeEmail: asOptionalString(assignee.email),
    assigneeDisplayName: asOptionalString(assignee.displayName),
    assigneeName: asOptionalString(assignee.name),
    stateName: asOptionalString(state.name),
    stateType: normalizeStateType(state.type),
    labelNames: labelNodes.map((item, index) => asOptionalString(asRecord(item, `${field}.labels.nodes[${index}]`).name)).filter(Boolean)
  };
}

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateText: string, days: number): string {
  const [year, month, day] = dateText.split("-").map((value) => Number.parseInt(value, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function priorityLabel(priority: number): string {
  switch (priority) {
    case 0:
      return "none";
    case 1:
      return "urgent";
    case 2:
      return "high";
    case 3:
      return "normal";
    case 4:
      return "low";
    default:
      return `${priority}`;
  }
}

function truncate(text: string, max = 1200): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function matchesAssignee(source: LinearIssuesSource, viewer: LinearViewer, issue: LinearIssueNode): boolean {
  if (!source.assignee) return true;
  if (source.assignee === "me") {
    return Boolean(
      (viewer.id && issue.assigneeId === viewer.id) ||
      (viewer.email && issue.assigneeEmail.toLowerCase() === viewer.email.toLowerCase())
    );
  }

  const needle = source.assignee.toLowerCase();
  return [
    issue.assigneeEmail,
    issue.assigneeDisplayName,
    issue.assigneeName
  ].some((value) => value.toLowerCase() === needle);
}

function matchesSourceFilters(source: LinearIssuesSource, viewer: LinearViewer, issue: LinearIssueNode): boolean {
  if (!issue.dueDate) return false;
  if (source.teamKey && issue.teamKey.toLowerCase() !== source.teamKey.toLowerCase()) return false;
  if (source.projectName && issue.projectName.toLowerCase() !== source.projectName.toLowerCase()) return false;
  if (!matchesAssignee(source, viewer, issue)) return false;

  const excludedStateTypes = new Set(source.excludeStateTypes ?? Array.from(DEFAULT_EXCLUDED_STATE_TYPES));
  if (excludedStateTypes.has(issue.stateType)) return false;

  if (source.stateNames && source.stateNames.length > 0) {
    const wanted = new Set(source.stateNames.map((value) => value.toLowerCase()));
    if (!wanted.has(issue.stateName.toLowerCase())) return false;
  }

  if (source.labelNames && source.labelNames.length > 0) {
    const issueLabels = new Set(issue.labelNames.map((value) => value.toLowerCase()));
    for (const label of source.labelNames) {
      if (!issueLabels.has(label.toLowerCase())) return false;
    }
  }

  if (typeof source.dueWithinDays === "number") {
    const maxDate = addDays(localDateString(), source.dueWithinDays);
    if (issue.dueDate > maxDate) return false;
  }

  return true;
}

function buildLinearDescription(issue: LinearIssueNode): string {
  const lines = [
    issue.url ? `Linear: ${issue.url}` : "",
    issue.teamKey ? `Team: ${issue.teamKey}${issue.teamName ? ` (${issue.teamName})` : ""}` : "",
    issue.projectName ? `Project: ${issue.projectName}` : "",
    issue.stateName ? `State: ${issue.stateName}${issue.stateType !== "unknown" ? ` [${issue.stateType}]` : ""}` : "",
    issue.assigneeDisplayName || issue.assigneeEmail
      ? `Assignee: ${issue.assigneeDisplayName || issue.assigneeName || issue.assigneeEmail}${issue.assigneeEmail ? ` <${issue.assigneeEmail}>` : ""}`
      : "",
    issue.labelNames.length > 0 ? `Labels: ${issue.labelNames.join(", ")}` : "",
    `Priority: ${priorityLabel(issue.priority)}`
  ].filter(Boolean);

  if (issue.description) {
    lines.push("", truncate(issue.description.trim()));
  }

  return lines.join("\n");
}

export function mapLinearIssuesToEvents(source: LinearIssuesSource, viewer: LinearViewer, issues: LinearIssueNode[]) {
  const reminders = source.reminders ?? DEFAULT_LINEAR_REMINDERS;
  return issues
    .filter((issue) => matchesSourceFilters(source, viewer, issue))
    .sort((left, right) => {
      if (left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate);
      return left.identifier.localeCompare(right.identifier);
    })
    .map((issue): ResolvedCalendarEvent => ({
      id: issue.identifier,
      summary: `${issue.identifier} — ${issue.title}`,
      description: buildLinearDescription(issue),
      sourceId: source.id,
      identityKey: `${source.id}:${issue.id}`,
      timeKind: "allDay",
      start: issue.dueDate,
      end: addDays(issue.dueDate, 1),
      recurrence: [],
      reminders
    }));
}

function graphqlRequest<TData>(apiKey: string, query: string, variables: Record<string, unknown>) {
  return effectPromise("linear graphql request", async (): Promise<TData> => {
    const response = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });
    const payload = await response.json() as { data?: TData; errors?: unknown };
    if (!response.ok) {
      throw new Error(`Linear GraphQL HTTP failure: ${response.status} ${JSON.stringify(payload)}`);
    }
    if (payload.errors) {
      throw new Error(`Linear GraphQL returned errors: ${JSON.stringify(payload.errors)}`);
    }
    if (!payload.data) {
      throw new Error("Linear GraphQL response was missing data.");
    }
    return payload.data;
  });
}

function fetchLinearIssuePage(apiKey: string, after = "") {
  return Effect.gen(function* () {
    const data = yield* graphqlRequest<{
      viewer: unknown;
      issues: {
        pageInfo?: {
          hasNextPage?: boolean;
          endCursor?: string | null;
        };
        nodes?: unknown[];
      };
    }>(apiKey, LINEAR_ISSUES_QUERY, { after: after || null });

    return {
      viewer: normalizeViewer(data.viewer),
      issues: Array.isArray(data.issues?.nodes)
        ? data.issues.nodes.map((node, index) => normalizeIssueNode(node, `issues.nodes[${index}]`))
        : [],
      hasNextPage: Boolean(data.issues?.pageInfo?.hasNextPage),
      endCursor: typeof data.issues?.pageInfo?.endCursor === "string" ? data.issues.pageInfo.endCursor : ""
    } satisfies LinearPage;
  });
}

export function resolveLinearIssuesSource(source: LinearIssuesSource) {
  return Effect.gen(function* () {
    hydrateEnvironmentRequirement(source.apiKeyEnv);
    const apiKey = process.env[source.apiKeyEnv];
    if (!apiKey) {
      const status = inspectEnvironmentRequirement(source.apiKeyEnv);
      return yield* Effect.fail(
        fail(`Linear source ${source.id} requires env var ${source.apiKeyEnv} to be set. ${formatEnvironmentRequirementStatus(status)}.`)
      );
    }

    let viewer: LinearViewer = {
      id: "",
      email: "",
      displayName: "",
      name: ""
    };
    const allIssues: LinearIssueNode[] = [];
    let after = "";

    for (let page = 0; page < 20; page += 1) {
      const result = yield* fetchLinearIssuePage(apiKey, after);
      viewer = result.viewer;
      allIssues.push(...result.issues);
      if (!result.hasNextPage || !result.endCursor) break;
      after = result.endCursor;
    }

    return mapLinearIssuesToEvents(source, viewer, allIssues);
  });
}
