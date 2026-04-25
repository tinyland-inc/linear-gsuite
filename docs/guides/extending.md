# Extending with New Source Adapters

The sync engine is source-agnostic. It operates on `ResolvedCalendarEvent`
arrays regardless of where they came from. Adding a new source type means
producing that array from a new data source.

## The interface

Every source adapter must produce `ResolvedCalendarEvent[]`:

```typescript
interface ResolvedCalendarEvent {
  id: string;              // display ID (e.g. "TIN-452", "weekly-standup")
  summary: string;         // calendar event title
  description: string;     // calendar event body
  sourceId: string;        // which source produced this event
  identityKey: string;     // globally unique key → deterministic GCal event ID
  timeKind: "dateTime" | "allDay";
  start: string;           // ISO 8601
  end: string;
  recurrence: string[];    // RRULE strings (empty for one-time events)
  reminders: { email: number; popup: number };  // minutes before event
}
```

The `identityKey` is critical: it feeds into `stableGoogleEventId()` which
produces the deterministic Google Calendar event ID. Two events with the
same identity key will map to the same calendar event.

Convention: `identityKey = "${source.id}:${unique-id-from-source}"`.

## Step-by-step: adding a source

### 1. Define the source type

In `src/types.ts`, add your source interface:

```typescript
export interface LinearProjectsSource {
  id: string;
  type: "linear-projects";
  apiKeyEnv: string;
  enabled?: boolean;
  description?: string;
  teamKey?: string;
  reminders?: ReminderOverrides;
}
```

Update the `CalendarSource` union:

```typescript
export type CalendarSource =
  | JsonRecurringEventsSource
  | LinearIssuesSource
  | LinearProjectsSource;
```

### 2. Write the resolver

Create a function that fetches data and maps it to `ResolvedCalendarEvent[]`.
For pure-function testability, split fetching from mapping:

```typescript
// src/linear.ts (or a new file)
export function mapLinearProjectsToEvents(
  source: LinearProjectsSource,
  projects: LinearProject[]
): ResolvedCalendarEvent[] {
  return projects
    .filter((p) => p.targetDate)
    .map((p) => ({
      id: p.identifier,
      summary: `${p.name} — target date`,
      description: `Project: ${p.name}\nStatus: ${p.status}`,
      sourceId: source.id,
      identityKey: `${source.id}:${p.id}`,
      timeKind: "allDay" as const,
      start: p.targetDate!,
      end: addDays(p.targetDate!, 1),
      recurrence: [],
      reminders: source.reminders ?? { email: 1440, popup: 30 }
    }));
}
```

### 3. Register in config loading

In `src/config.ts`, add a branch in `loadCalendarDefinition` for your
source type:

```typescript
if (source.type === "linear-projects") {
  const projectEvents = yield* resolveLinearProjectsSource(source);
  events.push(...projectEvents);
  resolvedSources.push({
    id: source.id,
    type: source.type,
    eventCount: projectEvents.length,
    implemented: true
  });
}
```

### 4. Test

The mapping function is pure — test it directly:

```typescript
it("maps projects with target dates to all-day events", () => {
  const events = mapLinearProjectsToEvents(source, projects);
  expect(events).toHaveLength(1);
  expect(events[0]?.timeKind).toBe("allDay");
});
```

The sync loop, dedup, and reconciliation work automatically for any source
that produces `ResolvedCalendarEvent[]`. No changes needed to `google.ts`.

## What the engine handles for you

Once your source produces events, the engine provides:

- **Deterministic IDs**: `stableGoogleEventId(identityKey)` ensures stable
  calendar events across syncs
- **Create/update**: automatic via GET → PUT/POST
- **Deduplication**: `pruneSyncIdDuplicates` removes duplicate events per
  identity
- **Reconciliation**: `reconcileStaleEvents` removes events that are no
  longer in the source set, scoped to your `source.id`
- **Tombstone safety**: cancelled GCal recurring instances are skipped
- **Dry-run**: `--dry-run` works for all sources
- **Extended properties**: `source`, `sync_id`, `source_id`, `google_event_id`
  are set automatically

## Potential future sources

| Source type | Data | Calendar value |
|-------------|------|---------------|
| `linear-projects` | Project target dates | Deadline visibility |
| `linear-initiatives` | Initiative target dates | Strategic deadlines |
| `linear-cycles` | Sprint start/end dates | Sprint cadence on calendar |
| `github-milestones` | Milestone due dates | Release tracking |
| `ical-feed` | External iCal/ICS feeds | Aggregation from other services |
