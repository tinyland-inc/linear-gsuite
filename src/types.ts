export type AuthMode = "auto" | "user" | "service-account";
export type EventTimeKind = "dateTime" | "allDay";
export type LinearIssueStateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled"
  | "unknown";

export interface ReminderOverrides {
  email: number;
  popup: number;
}

export interface CalendarEventSpec {
  id: string;
  summary: string;
  description: string;
  timeKind?: EventTimeKind;
  start: string;
  end: string;
  recurrence?: string[];
  reminders?: ReminderOverrides;
}

export interface ResolvedCalendarEvent extends CalendarEventSpec {
  sourceId: string;
  identityKey: string;
  reminders: ReminderOverrides;
  recurrence: string[];
  timeKind: EventTimeKind;
}

export interface JsonRecurringEventsFile {
  timezone: string;
  calendarId?: string;
  events: CalendarEventSpec[];
}

export interface JsonRecurringEventsSource {
  id: string;
  type: "json-recurring-events";
  path: string;
  enabled?: boolean;
  legacyIdentity?: boolean;
  description?: string;
  timezone?: string;
}

export interface LinearIssuesSource {
  id: string;
  type: "linear-issues";
  apiKeyEnv: string;
  enabled?: boolean;
  description?: string;
  teamKey?: string;
  projectName?: string;
  assignee?: "me" | string;
  labelNames?: string[];
  stateNames?: string[];
  excludeStateTypes?: LinearIssueStateType[];
  dueWithinDays?: number;
  reminders?: ReminderOverrides;
}

export type CalendarSource = JsonRecurringEventsSource | LinearIssuesSource;

export interface CalendarSyncAgentConfig {
  label?: string;
  startIntervalSeconds?: number;
}

export interface CalendarPackageManifest {
  name?: string;
  version?: string | number;
  timezone?: string;
  calendarId?: string;
  sources: CalendarSource[];
  agents?: {
    "calendar-sync"?: CalendarSyncAgentConfig;
  };
}

export interface LoadedCalendarDefinition {
  configFile: string;
  format: "legacy-events-file" | "calendar-package";
  timezone: string;
  calendarId?: string;
  agents?: CalendarPackageManifest["agents"];
  requiredEnvironment: string[];
  events: ResolvedCalendarEvent[];
  sources: Array<{
    id: string;
    type: CalendarSource["type"];
    path?: string;
    eventCount: number;
    legacyIdentity?: boolean;
    implemented: boolean;
  }>;
  watchPaths: string[];
}

export interface LocalConfig {
  authMode?: Exclude<AuthMode, "auto">;
  calendarId?: string;
  oauthClientFile?: string;
  oauthClientManagedFile?: string;
  oauthTokenFile?: string;
  serviceAccountFile?: string;
  impersonate?: string;
}

export interface InstalledOAuthClient {
  project_id?: string;
  client_id: string;
  client_secret?: string;
  redirect_uris?: string[];
}

export interface UserTokenFile {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_at?: string;
  issued_at?: string;
}

export interface SyncOptions {
  configFile: string;
  localConfigFile: string;
  authMode: AuthMode;
  oauthClientSecretsFile?: string;
  oauthTokenFile?: string;
  serviceAccountFile?: string;
  impersonate?: string;
  calendarId?: string;
  dryRun?: boolean;
}
