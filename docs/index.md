# linear-gsuite

A calendar automation engine that syncs [Linear](https://linear.app) issues and
recurring events into Google Calendar.

## What it does

- Syncs Linear issues with due dates as all-day Google Calendar events
- Syncs recurring operational events (weekly reviews, monthly invoicing, etc.)
- Automatically removes calendar events when issues are completed or canceled
- Deduplicates and reconciles calendar state on every sync cycle
- Runs as a macOS `launchd` background agent or one-shot CLI

## Architecture

`linear-gsuite` is an **engine**, not a business-data repo. Consumer repos
provide manifests that declare what to sync; this repo provides the machinery.

```
Consumer repo (e.g. finances/)          linear-gsuite engine
├── linear-gsuite.package.json   ──>    ├── Source resolution
├── events.json                  ──>    ├── Google Calendar API
└── runbooks, CSVs, etc.                ├── OAuth / service-account auth
                                        ├── Reconciliation + dedup
                                        └── launchd lifecycle
```

## Source types

| Type | Description | Events |
|------|-------------|--------|
| `json-recurring-events` | Static recurring events from a JSON file | Timed or all-day, with recurrence rules |
| `linear-issues` | Linear issues with due dates | All-day events, auto-removed on completion |

## Install

See the [Getting Started](guides/getting-started.md) guide for full setup, or
pick your install surface:

- **npm/pnpm**: `pnpm install && pnpm build && pnpm link --global`
- **nix run**: `nix run github:tinyland-inc/linear-gsuite -- version`
- **Home Manager**: import `homeManagerModules.default` from the flake

## Quick reference

```bash
linear-gsuite version                    # build identity
linear-gsuite auth login                 # OAuth desktop flow
linear-gsuite doctor --config manifest   # full health check
linear-gsuite calendar sync --config manifest          # sync now
linear-gsuite calendar sync --config manifest --dry-run  # preview
linear-gsuite launchd install sync --config manifest   # background agent
```

## Key design decisions

- **Stateless sync** — no local database. Google Calendar extended properties
  are the source of truth for what the engine has synced.
- **Effect.ts** — all async/error flows use the Effect library for typed,
  composable error handling.
- **`_FILE` pattern** — secrets are never passed as literal env vars in
  production. Use `LINEAR_API_KEY_FILE=/path` and the engine reads the file
  at runtime.
- **Source-scoped reconciliation** — removing a source from your manifest
  does not mass-delete its events. Only active sources are reconciled.
