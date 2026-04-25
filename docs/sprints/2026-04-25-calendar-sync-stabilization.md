# Calendar Sync Stabilization Sprint

Date: 2026-04-25

## User Story

As an operator running `linear-gsuite` from Home Manager on macOS, I can install one calendar sync agent that reads recurring event JSON and Linear due dates, runs safely under `launchd`, and gives me a clear health answer without exposing secrets or requiring ad hoc shell state.

## Feature Scope

P0 reliability:

- Runtime secret hydration: `LINEAR_API_KEY_FILE=/path` must hydrate `LINEAR_API_KEY` before any Linear source resolves.
- Idempotent duplicate pruning: Google Calendar duplicate deletes treat `204`, `404`, and `410 Gone` as successful terminal states.
- Doctor diagnostics: `doctor` and `calendar doctor` show required environment bindings with secret-safe status.
- Launchd install validation: manual and Home Manager installs fail clearly when a required env file is missing or unreadable.
- Version alignment: the consuming Home Manager flake must point at a pushed commit or tag that contains the runtime fixes.

P1 hardening:

- Keep duplicate candidate pruning bounded and deduplicated per sync run.
- Document launchd health signals, especially that an idle oneshot with `last exit code = 0` is healthy.
- Keep Linear issue sync and recurring JSON sync working together from one package manifest.

P2 exposure:

- Add build/version metadata so an installed binary can be tied back to source.
- Make doctor output compact enough to use as the first operator health check.

## API And Usage Contract

Manifest API:

- `json-recurring-events` sources read event specs from JSON files.
- `linear-issues` sources declare `apiKeyEnv`, usually `LINEAR_API_KEY`.
- Source IDs are part of event identity; changing them intentionally changes Google event identity unless `legacyIdentity` is enabled.

Secret API:

- Foreground sync may use `LINEAR_API_KEY`.
- Background sync should use `LINEAR_API_KEY_FILE=/path`.
- The CLI never prints secret values; diagnostics only report whether the value is set and whether the file path exists and is readable.

Operator CLI:

```bash
linear-gsuite version
linear-gsuite --version
linear-gsuite doctor --config /path/to/linear-gsuite.package.json
linear-gsuite calendar sync --config /path/to/linear-gsuite.package.json
linear-gsuite launchd install sync --config /path/to/linear-gsuite.package.json
linear-gsuite launchd status sync --config /path/to/linear-gsuite.package.json
```

Home Manager exposure:

```nix
programs.linear-gsuite.calendar.launchd.environmentFromFiles =
  builtins.listToAttrs [
    {
      name = "LINEAR_API_KEY";
      value = config.sops.secrets.linear-api-key.path;
    }
  ];
```

## Success Metrics

- User story: one Home Manager switch installs a sync agent that can run Linear and recurring sources without manual shell exports.
- Clean API: public usage is limited to package manifest source config, `NAME` or `NAME_FILE` env bindings, and the documented CLI commands.
- Feature exposure: README, example Home Manager module, and sprint doc all show the same `environmentFromFiles` path.
- Version exposure: `linear-gsuite --version` reports the package version, Nix build version, and source revision when installed from the flake.
- Runtime: two consecutive launchd syncs exit `0`.
- Logs: no `requires env var LINEAR_API_KEY` errors after reinstall.
- Logs: no repeated duplicate-delete failures for already-deleted Google event IDs.
- Calendar behavior: expected recurring events and Linear due-date events appear exactly once.
- Security: plist contains `LINEAR_API_KEY_FILE=/path`, not the literal Linear API key.
- Validation: `just test`, `just typecheck`, `just build`, and `nix build` pass before release.

## Testing Scope

Automated:

- `_FILE` hydration trims trailing newlines, preserves existing env values, and supports targeted source-level hydration.
- Env diagnostics describe missing, set, file-backed, missing-file, and unreadable-file states without printing values.
- Google duplicate pruning accepts `410 Gone` delete responses.
- Linear issue projection preserves filters, default exclusions, due windows, reminders, and stable identity.
- Package loading supports mixed source manifests.

Manual/live:

- Rebuild and install the package through the consuming Home Manager config.
- Confirm the generated plist contains only `_FILE` secret references.
- Run `linear-gsuite doctor --config ...`.
- Run foreground `calendar sync`, then `launchctl kickstart -k gui/$UID/<label>`.
- Inspect `~/Library/Logs/linear-gsuite-calendar-sync.err.log` for zero env and duplicate-delete failures.
