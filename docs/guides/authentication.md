# Authentication

`linear-gsuite` authenticates with two services: **Google Calendar** and
**Linear**. Each uses a different mechanism.

## Google Calendar

Two auth modes are supported: **desktop OAuth** (interactive, for personal
use) and **service account** (headless, for automation).

### Desktop OAuth (recommended for individuals)

Desktop OAuth uses the standard Google consent flow with PKCE. You authenticate
once in a browser; the engine stores a refresh token and mints access tokens
automatically on each sync.

#### Setup

1. Create a Desktop OAuth client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Enable the **Google Calendar API** on the project
3. Download the client secrets JSON

#### Login

```bash
linear-gsuite auth login --client-secrets-file ~/Downloads/client_secret_*.json
```

What happens under the hood:

1. The CLI starts a local HTTP server on a random port
2. It opens the Google authorization URL in your browser
3. After you grant consent, Google redirects to `http://localhost:<port>`
4. The CLI exchanges the authorization code (with PKCE verifier) for tokens
5. Tokens are saved to `~/.config/linear-gsuite/google-oauth-token.json`
6. The OAuth client JSON is copied to `~/.config/linear-gsuite/google-oauth-client.json`

If you cannot open a browser (e.g. SSH), pass `--no-open` and copy the
printed URL manually.

#### Token lifecycle

- **Refresh token**: stored permanently, survives reboots
- **Access token**: minted on each sync via refresh, valid ~1 hour
- **Revocation**: `linear-gsuite auth logout` deletes the token file

#### File locations

| File | Default path | Purpose |
|------|-------------|---------|
| OAuth client | `~/.config/linear-gsuite/google-oauth-client.json` | Managed copy of your client secrets |
| OAuth token | `~/.config/linear-gsuite/google-oauth-token.json` | Refresh + access token |
| Local config | `~/.config/linear-gsuite/config.json` | Auth mode, file paths, calendar ID |

### Service account (for headless/CI)

Service accounts use a JSON key file to mint JWT-based access tokens without
browser interaction. This is the right choice for CI pipelines or server
deployments.

#### Setup

1. Create a service account in [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Enable the **Google Calendar API**
3. Create and download a JSON key file
4. Share your target calendar with the service account's email address
   (found in the JSON key as `client_email`)

#### Usage

```bash
linear-gsuite calendar sync \
  --config manifest.json \
  --auth-mode service-account \
  --service-account-file /path/to/service-account.json
```

For Google Workspace domains, you can impersonate a user:

```bash
linear-gsuite calendar sync \
  --auth-mode service-account \
  --service-account-file /path/to/sa.json \
  --impersonate user@company.com \
  --config manifest.json
```

### Checking auth status

```bash
linear-gsuite auth status
```

Shows: config paths, client identity, token status, Calendar API probe
result, and visible calendar count. No secrets are printed.

## Linear

Linear uses a personal API key. The engine reads it from an environment
variable.

### Getting a Linear API key

1. Go to [Linear Settings > API](https://linear.app/settings/api)
2. Create a **Personal API key**
3. Copy the key (starts with `lin_api_`)

### Setting the key

For interactive use, set the environment variable to your key value.

For production, use the `_FILE` pattern — write the key to a file with
restricted permissions:

```bash
# Write your key to a file (not shown here for safety)
chmod 600 ~/.config/linear-gsuite/linear-api-key
export LINEAR_API_KEY_FILE=~/.config/linear-gsuite/linear-api-key
```

The engine reads the file at runtime and never logs the key value. The
`_FILE` pattern is the intended path for `launchd` agents and Home Manager
deployments.

### How the `_FILE` pattern works

When `linear-gsuite` starts, it scans the environment for any variable
ending in `_FILE`. For each one:

1. Strips the `_FILE` suffix to get the target variable name
2. Reads the file contents
3. Strips trailing newlines
4. Sets the target variable in-process

This means a `_FILE` variable is resolved to its target name with the file
contents as the value, at runtime, without exposing the secret in process
listings or logs.

### sops-nix integration

If you use [sops-nix](https://github.com/Mic92/sops-nix) for secret
management, your Home Manager config can reference decrypted secret paths
directly:

```nix
programs.linear-gsuite.calendar.launchd.environmentFromFiles =
  builtins.listToAttrs [{
    name = "LINEAR_API_KEY";
    value = config.sops.secrets.linear-api-key.path;
  }];
```

Home Manager converts this to `LINEAR_API_KEY_FILE=<decrypted path>` in
the launchd agent plist.
