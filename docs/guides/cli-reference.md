# CLI Reference

## Global flags

| Flag | Description |
|------|-------------|
| `--config FILE` | Calendar package manifest path (auto-discovered if omitted) |
| `--local-config-file FILE` | Local config path (default: `~/.config/linear-gsuite/config.json`) |

## Commands

### `version`

```bash
linear-gsuite version
linear-gsuite --version
linear-gsuite -v
```

Prints build identity: package name, version, build revision, and source.

### `doctor`

```bash
linear-gsuite doctor [--config FILE]
```

Full health check. Reports:

- **[environment]** — required env vars and their status
- **[package]** — manifest path, sources, event counts
- **[auth]** — OAuth/service-account status, token validity
- **[calendar]** — calendar doctor with accessible calendars
- **[synced events]** — events currently on the calendar from this engine
- **[launchd]** — background agent status (macOS)

Run this first when debugging sync issues.

### `auth login`

```bash
linear-gsuite auth login [--client-secrets-file FILE] [--token-file FILE] [--no-open]
```

Interactive OAuth desktop flow. Opens a browser for Google consent, saves
tokens locally. Pass `--no-open` to print the URL instead of opening it.

The CLI auto-discovers `client_secret_*.json` files in `~/Downloads` if
`--client-secrets-file` is not specified.

### `auth status`

```bash
linear-gsuite auth status
```

Shows auth configuration and probes the Calendar API. Does not expose
secret values.

### `auth logout`

```bash
linear-gsuite auth logout
```

Removes the stored OAuth token file.

### `calendar sync`

```bash
linear-gsuite calendar sync [--config FILE] [--dry-run] [--auth-mode MODE] [--calendar-id ID]
```

The main sync command. For each event in the manifest:

1. Creates or updates the Google Calendar event
2. Prunes duplicate events
3. After all events: reconciles stale events (removes orphans)

**Output format** (tab-separated, machine-readable):

```
created     TIN-452
updated     weekly-standup
removed-stale   TIN-372   lgsad23c009b6cde...
reconciled  2   stale events
```

| Flag | Values | Default |
|------|--------|---------|
| `--dry-run` | — | off |
| `--auth-mode` | `auto`, `user`, `service-account` | `auto` |
| `--calendar-id` | calendar ID string | from config or `"primary"` |

### `calendar doctor`

```bash
linear-gsuite calendar doctor [--config FILE]
```

Detailed calendar-specific diagnostics: auth mode, calendar ID, source
details, accessible calendars, launchd config.

### `calendar list-calendars`

```bash
linear-gsuite calendar list-calendars
```

Lists all calendars accessible to the authenticated account.

### `calendar set-calendar`

```bash
linear-gsuite calendar set-calendar --calendar-id CALENDAR_ID
```

Saves the target calendar ID to local config.

### `calendar show-events`

```bash
linear-gsuite calendar show-events
```

Lists events currently on Google Calendar that were created by this engine
(filtered by `source=linear-gsuite` extended property).

### `launchd install sync`

```bash
linear-gsuite launchd install sync --config FILE
```

Installs a macOS `launchd` agent that runs `calendar sync` on a timer.
The interval is configured in the manifest under `agents.calendar-sync.startIntervalSeconds`
(default: 21600 seconds = 6 hours).

Environment variables present at install time are captured into the plist.
Use `_FILE` variables for secrets.

### `launchd status sync`

```bash
linear-gsuite launchd status sync [--config FILE]
```

Shows the launchd agent status: loaded, PID, last exit code, label.

### `launchd uninstall sync`

```bash
linear-gsuite launchd uninstall sync [--config FILE]
```

Removes the launchd agent and its plist.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (message printed to stderr) |

## Programmatic API

All CLI commands are backed by exported functions:

```typescript
import { syncCalendar, reconcileStaleEvents, authLogin } from "@tummycrypt/linear-gsuite";
import { Effect } from "effect";

await Effect.runPromise(syncCalendar(options, cwd));
```

See `types.ts` for `SyncOptions` and all public interfaces.
