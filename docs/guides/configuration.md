# Configuration

## Manifest schema

The calendar package manifest (`linear-gsuite.package.json`) is the primary
configuration surface. It declares what sources to sync and how.

```typescript
interface CalendarPackageManifest {
  name?: string;
  version?: string | number;
  timezone?: string;            // IANA timezone (e.g. "America/New_York")
  calendarId?: string;          // target Google Calendar ID
  sources: CalendarSource[];    // one or more source adapters
  agents?: {
    "calendar-sync"?: {
      label?: string;           // launchd job label
      startIntervalSeconds?: number;  // sync interval (default: 21600 = 6h)
    };
  };
}
```

## Source types

### `json-recurring-events`

Syncs static events from a JSON file. Good for recurring cadences (weekly
reviews, monthly invoicing, etc.).

```typescript
interface JsonRecurringEventsSource {
  id: string;
  type: "json-recurring-events";
  path: string;                 // relative to manifest directory
  enabled?: boolean;            // default: true
  legacyIdentity?: boolean;     // use event.id as identity key (default: false)
  description?: string;
  timezone?: string;            // override manifest timezone for this source
}
```

The referenced JSON file:

```typescript
interface JsonRecurringEventsFile {
  timezone: string;
  calendarId?: string;
  events: CalendarEventSpec[];
}

interface CalendarEventSpec {
  id: string;                   // stable identifier
  summary: string;
  description: string;
  start: string;                // ISO 8601 datetime or date
  end: string;
  timeKind?: "dateTime" | "allDay";  // inferred from start format if omitted
  recurrence?: string[];        // RRULE strings
  reminders?: { email: number; popup: number };  // minutes before event
}
```

### `linear-issues`

Syncs Linear issues with due dates as all-day Google Calendar events.

```typescript
interface LinearIssuesSource {
  id: string;
  type: "linear-issues";
  apiKeyEnv: string;            // env var name (e.g. "LINEAR_API_KEY")
  enabled?: boolean;
  description?: string;
  teamKey?: string;             // filter by team (e.g. "ENG")
  projectName?: string;         // filter by project name
  assignee?: "me" | string;    // filter by assignee ("me" = API key owner)
  labelNames?: string[];        // filter by label names
  stateNames?: string[];        // filter by state names
  excludeStateTypes?: LinearIssueStateType[];  // default: ["completed", "canceled"]
  dueWithinDays?: number;       // only issues due within N days
  reminders?: { email: number; popup: number };
}

type LinearIssueStateType =
  | "triage" | "backlog" | "unstarted"
  | "started" | "completed" | "canceled" | "unknown";
```

When an issue transitions to a completed or canceled state, the next sync
cycle automatically removes its calendar event.

## Config discovery

If you omit `--config`, the CLI searches for a manifest in this order:

1. `./linear-gsuite.package.json`
2. `./calendar/linear-gsuite.package.json`
3. `./calendar/package.json`

## Local config

The local config at `~/.config/linear-gsuite/config.json` stores auth mode,
file paths, and calendar preferences. It is written by `auth login` and
`launchd install`, and can be set manually:

```json
{
  "authMode": "user",
  "calendarId": "primary",
  "oauthClientManagedFile": "~/.config/linear-gsuite/google-oauth-client.json",
  "oauthTokenFile": "~/.config/linear-gsuite/google-oauth-token.json"
}
```

## Mixing sources

A single manifest can combine multiple sources. Events from all sources
are merged and synced to the same calendar:

```json
{
  "name": "ops-calendar",
  "timezone": "America/New_York",
  "sources": [
    {
      "id": "recurring",
      "type": "json-recurring-events",
      "path": "./events.json"
    },
    {
      "id": "linear-due-soon",
      "type": "linear-issues",
      "apiKeyEnv": "LINEAR_API_KEY",
      "assignee": "me",
      "teamKey": "ENG",
      "dueWithinDays": 7
    }
  ]
}
```

## Identity keys

Each synced event has a deterministic Google Calendar event ID derived from
its identity key:

- **json-recurring-events**: `${source.id}:${event.id}` (or just `event.id`
  if `legacyIdentity: true`)
- **linear-issues**: `${source.id}:${issue.uuid}`

The Google event ID is `lgs` + SHA1 of the identity key. This means events
are stable across syncs — updating an event's content preserves its calendar
ID and any user-added notes or color overrides.

## Extended properties

Every synced event carries private extended properties on the Google Calendar
event:

| Property | Value | Purpose |
|----------|-------|---------|
| `source` | `"linear-gsuite"` | Identifies events created by this engine |
| `sync_id` | event ID (e.g. `"TIN-452"`) | Maps back to the source event |
| `source_id` | source ID (e.g. `"linear-due-soon"`) | Scopes reconciliation |
| `google_event_id` | stable SHA1-based ID | Cross-references the canonical event |

These properties enable the reconciliation phase to find and clean up stale
events without affecting manually-created calendar events.
