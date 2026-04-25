# linear-gsuite

Calendar automation engine that syncs [Linear](https://linear.app) issues and
recurring events into Google Calendar.

- Syncs Linear issues with due dates as all-day calendar events
- Syncs recurring operational events from JSON definitions
- Automatically removes calendar events when issues are completed or canceled
- Runs as a macOS `launchd` background agent or one-shot CLI
- Declarative setup via Home Manager (NixOS / nix-darwin)

## Quick start

```bash
# Install
pnpm install && pnpm build

# Authenticate with Google Calendar
linear-gsuite auth login --client-secrets-file ~/Downloads/client_secret_*.json

# Create a manifest (or use an example)
linear-gsuite doctor --config examples/tinyland-business-ops/linear-gsuite.package.json

# Sync
linear-gsuite calendar sync --config examples/tinyland-business-ops/linear-gsuite.package.json
```

Or via nix:

```bash
nix run github:tinyland-inc/linear-gsuite -- version
```

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/guides/getting-started.md) | Install, authenticate, first sync |
| [Authentication](docs/guides/authentication.md) | OAuth desktop flow, service accounts, `_FILE` secret pattern |
| [Configuration](docs/guides/configuration.md) | Manifest schema, source types, identity keys |
| [CLI Reference](docs/guides/cli-reference.md) | All commands, flags, output format |
| [Home Manager](docs/guides/home-manager.md) | Declarative NixOS/nix-darwin setup |
| [Extending](docs/guides/extending.md) | Adding new source adapters |
| [Troubleshooting](docs/guides/troubleshooting.md) | Common issues and diagnostics |

## Source types

| Type | Description |
|------|-------------|
| `json-recurring-events` | Static recurring events from a JSON file |
| `linear-issues` | Linear issues with due dates, auto-removed on completion |

## Install surfaces

| Method | Command |
|--------|---------|
| **pnpm** | `pnpm install && pnpm build && pnpm link --global` |
| **nix run** | `nix run github:tinyland-inc/linear-gsuite -- <args>` |
| **nix develop** | `nix develop` for dev shell with all tooling |
| **Home Manager** | Import `homeManagerModules.default` ([guide](docs/guides/home-manager.md)) |

## Architecture

This repo is the **engine**. Consumer repos provide **manifests**.

```
Consumer repo                    linear-gsuite engine
├── linear-gsuite.package.json   → Source resolution
├── events.json                  → Google Calendar API (OAuth + service account)
└── business data                → Reconciliation, dedup, launchd lifecycle
```

The engine is source-agnostic: it syncs any `ResolvedCalendarEvent[]`
regardless of origin. New source adapters only need to produce that type.
See the [Extending guide](docs/guides/extending.md).

## Example manifest

```json
{
  "name": "my-calendar",
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

## Development

```bash
pnpm install
pnpm run typecheck   # type check
pnpm test            # vitest (13 tests)
pnpm run build       # compile to dist/
just status          # toolchain overview
```

CI runs typecheck, test, build, and publint on every PR.

## License

MIT
