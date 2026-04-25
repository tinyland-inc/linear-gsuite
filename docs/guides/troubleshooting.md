# Troubleshooting

## First step: run doctor

```bash
linear-gsuite doctor --config your-manifest.json
```

Doctor checks environment, config, auth, calendar access, synced events,
and launchd status in one command.

## Authentication issues

### `calendar api: 401`

Your access token is expired or invalid.

- **User auth**: Try `linear-gsuite auth login` to re-authenticate
- **Service account**: Verify the JSON key file is valid and the Calendar
  API is enabled on the project

### `calendars visible: 0`

The authenticated account cannot see any calendars.

- **User auth**: This usually means the OAuth scope was not granted. Re-run
  `auth login`.
- **Service account**: Share your target calendar with the service account's
  `client_email` address (found in the JSON key file).

### `Failed to mint access token`

- **User auth**: The refresh token may have been revoked. Delete the token
  file and re-authenticate:
  ```bash
  linear-gsuite auth logout
  linear-gsuite auth login
  ```
- **Service account**: Check that the private key in the JSON file is valid
  and not expired.

## Linear issues

### Issues not appearing on calendar

Check each filter:

1. **Due date**: The issue must have a due date set in Linear
2. **Due window**: The due date must be within `dueWithinDays` of today
3. **Team**: If `teamKey` is set, the issue must be on that team
4. **Project**: If `projectName` is set, the issue must be in that project
5. **Assignee**: If `assignee: "me"`, the issue must be assigned to the
   API key owner
6. **State**: Issues in `excludeStateTypes` are filtered out (default:
   completed, canceled)

Run a sync with verbose output to see what's being processed:

```bash
linear-gsuite calendar sync --config manifest.json --dry-run
```

### Linear API key missing

Set the environment variable or use the `_FILE` pattern:

```bash
export LINEAR_API_KEY_FILE=/path/to/key-file
```

For launchd agents, pass the file at install time:

```bash
LINEAR_API_KEY_FILE=/path/to/key linear-gsuite launchd install sync --config manifest.json
```

## Calendar sync issues

### Events duplicated on calendar

The dedup phase runs on every sync. If duplicates persist:

1. Check `linear-gsuite calendar show-events` for multiple entries
2. Run a normal sync — it should clean up duplicates automatically
3. If duplicates have different extended properties, they may be from
   different sources or a renamed source ID

### Completed issues still on calendar

The reconciliation phase removes events for completed/canceled issues.
If an event persists:

1. Run a sync — the reconciliation phase runs after the upsert loop
2. Check that the issue's state type is in `excludeStateTypes`
3. Check that the source ID in the manifest matches the `source_id`
   extended property on the stale event

### `Failed to update / Failed to create`

Usually a permissions issue:

- The authenticated account must have write access to the target calendar
- Check `--calendar-id` matches a calendar you own or have editor access to

## launchd issues

### Agent not running

Check status:

```bash
launchctl list | grep linear-gsuite
```

A oneshot timer agent shows `state = not running` between intervals. This
is normal. Check `last exit code`:

- **0**: Last sync succeeded
- **1**: Last sync failed — check stderr log

### Checking logs

```bash
tail -20 ~/Library/Logs/linear-gsuite-calendar-sync.out.log
tail -20 ~/Library/Logs/linear-gsuite-calendar-sync.err.log
```

The stdout log shows tab-separated sync actions. The stderr log shows
errors.

### Agent using wrong version

After updating the nix package, the launchd agent still points to the old
nix store path. Re-run:

```bash
linear-gsuite launchd install sync --config manifest.json
```

Or, with Home Manager, run `home-manager switch` which re-runs the
activation hook.

### `WatchPaths` triggering too often

The launchd plist watches config and event files. If those files change
frequently (e.g. during development), the agent re-runs on each change.
This is by design but can produce many sync cycles. The sync is idempotent,
so extra runs are safe but may use API quota.

## Environment

### Node version mismatch

`linear-gsuite` requires Node.js 22+. Check:

```bash
node --version
```

If using nix, the dev shell provides the correct version:

```bash
nix develop
node --version  # v22.x
```
