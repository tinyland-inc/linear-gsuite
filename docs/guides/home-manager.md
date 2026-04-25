# Home Manager Integration

`linear-gsuite` ships a Home Manager module for declarative NixOS and
nix-darwin deployments.

## Importing the module

Add `linear-gsuite` as a flake input and import the module:

```nix
# flake.nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    home-manager.url = "github:nix-community/home-manager";
    linear-gsuite.url = "github:tinyland-inc/linear-gsuite";
  };

  outputs = { nixpkgs, home-manager, linear-gsuite, ... }: {
    homeConfigurations.you = home-manager.lib.homeManagerConfiguration {
      # ...
      modules = [
        linear-gsuite.homeManagerModules.default
        ./home.nix
      ];
    };
  };
}
```

## Minimal configuration

```nix
# home.nix
{ config, ... }:
{
  programs.linear-gsuite = {
    enable = true;

    calendar = {
      enable = true;
      calendarId = "primary";
      packageFile = "/path/to/your/linear-gsuite.package.json";
    };
  };
}
```

This installs the `linear-gsuite` CLI and writes a local config. On macOS,
it also installs a `launchd` background sync agent.

## Full configuration with secrets

Using [sops-nix](https://github.com/Mic92/sops-nix) for secret management:

```nix
{ config, ... }:
{
  programs.linear-gsuite = {
    enable = true;

    calendar = {
      enable = true;
      calendarId = "primary";
      packageFile = "/path/to/linear-gsuite.package.json";

      # Auth settings (written to ~/.config/linear-gsuite/config.json)
      authMode = "user";
      oauthTokenFile = "~/.config/linear-gsuite/google-oauth-token.json";

      # launchd background agent (macOS only, enabled by default on Darwin)
      launchd = {
        enable = true;

        # Secrets via _FILE pattern — never exposed as literal values
        environmentFromFiles = builtins.listToAttrs [{
          name = "LINEAR_API_KEY";
          value = config.sops.secrets.linear-api-key.path;
        }];

        # Non-secret environment (literal values are fine here)
        environment = {
          TZ = "America/New_York";
        };
      };
    };
  };
}
```

## Module options reference

### `programs.linear-gsuite`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enable` | bool | `false` | Install the `linear-gsuite` package |
| `package` | package | `pkgs.linear-gsuite` | Package derivation to use |
| `config` | null or JSON | `null` | Extra config merged into `config.json` |

### `programs.linear-gsuite.calendar`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enable` | bool | `false` | Enable calendar sync workflow |
| `packageFile` | null or string | `null` | Absolute path to manifest |
| `authMode` | enum | `"user"` | `"auto"`, `"user"`, or `"service-account"` |
| `calendarId` | string | `"primary"` | Target Google Calendar ID |
| `oauthClientFile` | null or string | `null` | Path to OAuth client JSON |
| `oauthTokenFile` | null or string | `null` | Path to OAuth token JSON |
| `serviceAccountFile` | null or string | `null` | Path to service account JSON |
| `impersonate` | null or string | `null` | Email to impersonate (service accounts) |

### `programs.linear-gsuite.calendar.launchd`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enable` | bool | `isDarwin` | Install launchd agent (macOS default: true) |
| `environment` | attrs of string | `{}` | Literal env vars for the agent |
| `environmentFromFiles` | attrs of string | `{}` | `NAME = "/path"` pairs → `NAME_FILE=/path` at runtime |

## How it works

On `home-manager switch`:

1. The `linear-gsuite` package is installed to your profile
2. `~/.config/linear-gsuite/config.json` is written with your auth settings
3. On macOS: the activation script runs `linear-gsuite launchd install sync`
   with the configured environment, creating a `launchd` plist

The launchd agent:

- Runs `calendar sync` every 6 hours (configurable via manifest)
- Also triggers on `WatchPaths` changes (manifest file, events file, config, secret file)
- Logs to `~/Library/Logs/linear-gsuite-calendar-sync.{out,err}.log`

## Pinning a version

Pin the flake input to a specific commit for reproducible builds:

```nix
linear-gsuite = {
  url = "github:tinyland-inc/linear-gsuite";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

After updating `linear-gsuite` upstream:

```bash
nix flake update linear-gsuite
home-manager switch --flake .#your-config
```

## Verifying the deployment

```bash
# Check installed version
linear-gsuite version

# Full health check
linear-gsuite doctor --config /path/to/manifest.json

# Check launchd agent
launchctl list | grep linear-gsuite
```
