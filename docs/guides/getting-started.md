# Getting Started

This guide walks through installing `linear-gsuite`, authenticating with
Google Calendar and Linear, and running your first sync.

## Prerequisites

- Node.js 22+ (or Nix)
- A Google account with Calendar access
- A Linear workspace (if using the `linear-issues` source)

## 1. Install

=== "pnpm"

    ```bash
    git clone https://github.com/tinyland-inc/linear-gsuite.git
    cd linear-gsuite
    pnpm install
    pnpm build
    ```

    Run commands with `node dist/cli.js` or link globally:

    ```bash
    pnpm link --global
    linear-gsuite version
    ```

=== "nix run"

    No install needed. Run directly from the flake:

    ```bash
    nix run github:tinyland-inc/linear-gsuite -- version
    ```

=== "nix develop"

    Enter the dev shell with all tooling:

    ```bash
    nix develop github:tinyland-inc/linear-gsuite
    just status
    ```

=== "Home Manager"

    See the [Home Manager guide](home-manager.md) for full NixOS/nix-darwin
    integration.

## 2. Create a Google OAuth client

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a project (or use an existing one)
3. Enable the **Google Calendar API**
4. Create an **OAuth 2.0 Client ID** of type **Desktop application**
5. Download the client secrets JSON

The file will be named something like `client_secret_XXXX.apps.googleusercontent.com.json`.

## 3. Authenticate

```bash
linear-gsuite auth login --client-secrets-file ~/Downloads/client_secret_*.json
```

This opens your browser for the Google OAuth consent flow. After granting
Calendar access, the token is saved to `~/.config/linear-gsuite/google-oauth-token.json`.

Verify with:

```bash
linear-gsuite auth status
```

You should see `calendar api: 200` and `calendars visible: N`.

## 4. Create a manifest

Create a `linear-gsuite.package.json` in your project:

```json
{
  "name": "my-calendar",
  "timezone": "America/New_York",
  "sources": [
    {
      "id": "weekly-events",
      "type": "json-recurring-events",
      "path": "./events.json"
    }
  ]
}
```

And a companion `events.json`:

```json
{
  "timezone": "America/New_York",
  "events": [
    {
      "id": "weekly-standup",
      "summary": "Weekly standup",
      "description": "Team sync.",
      "start": "2026-01-05T09:00:00-05:00",
      "end": "2026-01-05T09:30:00-05:00",
      "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=MO"]
    }
  ]
}
```

## 5. Run doctor

```bash
linear-gsuite doctor --config linear-gsuite.package.json
```

Doctor checks your environment, manifest, auth, and calendar accessibility
in one command. Fix any issues it reports before syncing.

## 6. First sync

Preview what would happen:

```bash
linear-gsuite calendar sync --config linear-gsuite.package.json --dry-run
```

Then sync for real:

```bash
linear-gsuite calendar sync --config linear-gsuite.package.json
```

Each synced event prints a tab-separated line:

```
created    weekly-standup
```

## 7. Add Linear issues (optional)

To sync Linear issues with due dates, add a `linear-issues` source:

```json
{
  "name": "my-calendar",
  "timezone": "America/New_York",
  "sources": [
    {
      "id": "weekly-events",
      "type": "json-recurring-events",
      "path": "./events.json"
    },
    {
      "id": "my-linear-issues",
      "type": "linear-issues",
      "apiKeyEnv": "LINEAR_API_KEY",
      "assignee": "me",
      "teamKey": "ENG",
      "dueWithinDays": 14,
      "excludeStateTypes": ["completed", "canceled"]
    }
  ]
}
```

Set your Linear API key via the `_FILE` pattern (recommended):

```bash
# Write your key from Linear Settings > API to a file
chmod 600 ~/.config/linear-gsuite/linear-api-key
export LINEAR_API_KEY_FILE=~/.config/linear-gsuite/linear-api-key
```

Or set `LINEAR_API_KEY` directly for quick interactive use.

Then sync again. Issues with due dates within the next 14 days will appear
as all-day events on your calendar. When you complete or cancel an issue in
Linear, the next sync removes the calendar event automatically.

## 8. Background sync (macOS)

Install a `launchd` agent to sync every 6 hours:

```bash
linear-gsuite launchd install sync --config linear-gsuite.package.json
```

Check status:

```bash
linear-gsuite launchd status sync --config linear-gsuite.package.json
```

The agent runs as a oneshot timer. Between intervals, `launchctl` reports
`state = not running` — that is normal. The real health signal is
`last exit code = 0`.

## Next steps

- [Authentication](authentication.md) — OAuth details, service accounts,
  secret management
- [Configuration](configuration.md) — manifest schema, source options,
  config discovery
- [Home Manager](home-manager.md) — declarative NixOS/nix-darwin setup
- [Extending](extending.md) — adding new source adapters
