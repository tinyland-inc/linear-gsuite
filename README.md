# linear-gsuite

`linear-gsuite` is the extracted automation engine that was previously tangled into `finances`.

It owns:

- Google Calendar desktop OAuth lifecycle
- calendar package loading and source resolution
- Linear issue projection into Google Calendar
- recurring event sync into Google Calendar
- `launchd` lifecycle for background sync
- Home Manager friendly packaging surfaces

It does **not** own your business data or runbooks.

Those stay in the consuming repo. For Tinyland, that means `finances` keeps:

- business ops runbooks
- `data/operations/*.csv`
- business-specific calendar manifests and event definitions

This repo is the engine. Consumer repos provide manifests.

## Current source model

Implemented today:

- `json-recurring-events`
- `linear-issues`

The package manifest exists so a consumer repo can project multiple sources into one Google Calendar without rewriting auth, sync, or launch-agent plumbing.

## Primary workflow

Install dependencies:

```bash
pnpm install
```

Authenticate once:

```bash
pnpm exec tsx src/cli.ts auth login
```

Run doctor against an example manifest:

```bash
pnpm exec tsx src/cli.ts doctor --config examples/tinyland-business-ops/linear-gsuite.package.json
```

Sync events:

```bash
pnpm exec tsx src/cli.ts calendar sync --config examples/tinyland-business-ops/linear-gsuite.package.json
```

Install background sync on macOS:

```bash
pnpm build
node dist/cli.js launchd install sync --config examples/tinyland-business-ops/linear-gsuite.package.json
```

Between intervals, `launchctl` will often report the agent as `state = not running`. That is normal for a healthy oneshot sync job. The real health signal is `last exit code = 0`.

If the package manifest enables source adapters that depend on environment variables, such as `linear-issues`, those variables must be present when you run `launchd install sync`. `linear-gsuite` captures the required values into the installed agent so the background job does not depend on ambient shell state.

## Install surfaces

This repo is meant to be consumable in a few stable ways:

### `nix run`

The flake exposes a runnable app:

```bash
nix run . -- doctor --config examples/tinyland-business-ops/linear-gsuite.package.json
```

### Home Manager

The flake also exports `homeManagerModules.default`.

Example:

```nix
{
  imports = [
    inputs.linear-gsuite.homeManagerModules.default
  ];

  programs.linear-gsuite = {
    enable = true;

    calendar = {
      enable = true;
      calendarId = "primary";
      packageFile = "/Users/jess/git/finances/data/operations/calendar/linear-gsuite.package.json";
    };
  };
}
```

That installs the CLI, writes `~/.config/linear-gsuite/config.json`, and can install the macOS `launchd` sync agent during activation.

### Local JavaScript install

For a non-Nix local install:

```bash
pnpm install
pnpm build
pnpm link --global
```

That gives you a `linear-gsuite` binary on `PATH`.

## Consumer repo model

A consumer repo should keep a manifest like `linear-gsuite.package.json` or `calendar/linear-gsuite.package.json`:

```json
{
  "name": "example-calendar",
  "sources": [
    {
      "id": "ops-recurring",
      "type": "json-recurring-events",
      "path": "./events.json",
      "legacyIdentity": true
    }
  ]
}
```

Then run:

```bash
linear-gsuite calendar sync --config path/to/linear-gsuite.package.json
```

## House style

This repo follows the adjacent Tinyland package pattern:

- `pnpm` is the primary human workflow
- Bazel is the hermetic build graph
- `flake.nix` provides dev/install surfaces
- `justfile` is the single operator entrypoint

## Example Linear source

`examples/linear-due-dates/linear-gsuite.package.json` shows the issue-projection path:

```json
{
  "name": "tinyland-linear-due-dates",
  "timezone": "America/New_York",
  "sources": [
    {
      "id": "my-linear-issues",
      "type": "linear-issues",
      "apiKeyEnv": "LINEAR_API_KEY",
      "assignee": "me",
      "teamKey": "TIN",
      "dueWithinDays": 14
    }
  ]
}
```

That source emits all-day events for due-dated issues and is intended to be mixed with recurring cadence events from the same manifest.

## Why the consumer split matters

The intended ownership model is:

- consumer repo:
  - runbooks
  - manifests
  - business data
  - business-specific recurrence definitions
- `linear-gsuite`:
  - auth lifecycle
  - Google Calendar sync
  - launchd lifecycle
  - reusable source adapters
  - packaging and install surfaces

That keeps `finances` authoritative for business truth without forcing it to also be the calendar automation engine.
