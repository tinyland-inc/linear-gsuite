{ config, lib, pkgs, ... }:

let
  cfg = config.programs.linear-gsuite;
  jsonFormat = pkgs.formats.json { };
  launchdLiteralEnvironment = cfg.calendar.launchd.environment or { };
  launchdFileEnvironment = cfg.calendar.launchd.environmentFromFiles or { };

  managedConfig =
    (if cfg.config == null then { } else cfg.config)
    // lib.optionalAttrs cfg.calendar.enable {
      authMode = cfg.calendar.authMode;
      calendarId = cfg.calendar.calendarId;
    }
    // lib.optionalAttrs (cfg.calendar.oauthClientFile != null) {
      oauthClientFile = cfg.calendar.oauthClientFile;
    }
    // lib.optionalAttrs (cfg.calendar.oauthTokenFile != null) {
      oauthTokenFile = cfg.calendar.oauthTokenFile;
    }
    // lib.optionalAttrs (cfg.calendar.serviceAccountFile != null) {
      serviceAccountFile = cfg.calendar.serviceAccountFile;
    }
    // lib.optionalAttrs (cfg.calendar.impersonate != null) {
      impersonate = cfg.calendar.impersonate;
    };
in
{
  options.programs.linear-gsuite = {
    enable = lib.mkEnableOption "linear-gsuite calendar automation toolkit";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.linear-gsuite or (builtins.throw
        "linear-gsuite not found in pkgs. Add the linear-gsuite overlay or set programs.linear-gsuite.package.");
      defaultText = lib.literalExpression "pkgs.linear-gsuite";
      description = "The linear-gsuite package to install.";
    };

    config = lib.mkOption {
      type = lib.types.nullOr jsonFormat.type;
      default = null;
      description = ''
        Extra linear-gsuite configuration written to
        ~/.config/linear-gsuite/config.json.
      '';
    };

    calendar = {
      enable = lib.mkEnableOption "Google Calendar sync workflow";

      packageFile = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "/Users/jess/git/finances/data/operations/calendar/linear-gsuite.package.json";
        description = ''
          Absolute path to the consumer manifest, typically
          linear-gsuite.package.json inside another repo.
        '';
      };

      authMode = lib.mkOption {
        type = lib.types.enum [ "auto" "user" "service-account" ];
        default = "user";
        description = "Authentication mode written into ~/.config/linear-gsuite/config.json.";
      };

      calendarId = lib.mkOption {
        type = lib.types.str;
        default = "primary";
        description = "Target Google Calendar ID.";
      };

      oauthClientFile = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Optional path to the desktop OAuth client JSON.";
      };

      oauthTokenFile = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Optional path to the stored Google OAuth token JSON.";
      };

      serviceAccountFile = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Optional path to a Google service-account JSON file.";
      };

      impersonate = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Optional Google Workspace user to impersonate in service-account mode.";
      };

      launchd.enable = lib.mkOption {
        type = lib.types.bool;
        default = pkgs.stdenv.isDarwin;
        description = "Install the launchd sync agent during Home Manager activation on macOS.";
      };

      launchd.environment = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = { };
        example = {
          LINEAR_API_KEY = "lin_api_xxx";
        };
        description = ''
          Extra environment values passed to `linear-gsuite launchd install sync`
          during Home Manager activation.

          These values are written directly into the installed launch agent.
          Prefer `launchd.environmentFromFiles` for secrets.
        '';
      };

      launchd.environmentFromFiles = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = { };
        example = lib.literalExpression ''
          {
            LINEAR_API_KEY = config.sops.secrets.linear-api-key.path;
          }
        '';
        description = ''
          Map of environment variable name to file path. Home Manager passes the
          file paths through to `linear-gsuite launchd install sync` as
          `''${NAME}_FILE`, and the CLI loads the values at runtime.

          This is the preferred way to wire secrets such as `LINEAR_API_KEY`
          from `sops-nix` or another secret manager.
        '';
      };
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ cfg.package ];

    xdg.configFile = lib.mkIf (cfg.config != null || cfg.calendar.enable) {
      "linear-gsuite/config.json".source =
        jsonFormat.generate "linear-gsuite-config.json" managedConfig;
    };

    home.activation.linearGsuiteLaunchd = lib.mkIf (cfg.calendar.enable && cfg.calendar.launchd.enable && pkgs.stdenv.isDarwin && cfg.calendar.packageFile != null) (
      lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        if [ -x "${cfg.package}/bin/linear-gsuite" ]; then
          env_args=()
          ${lib.concatStringsSep "\n" (lib.mapAttrsToList (name: value: ''
            env_args+=(${lib.escapeShellArg "${name}=${value}"})
          '') launchdLiteralEnvironment)}
          ${lib.concatStringsSep "\n" (lib.mapAttrsToList (name: file: ''
            if [ ! -r ${lib.escapeShellArg file} ]; then
              echo "linear-gsuite: missing readable environment file for ${name}: ${file}" >&2
              exit 1
            fi
            env_args+=(${lib.escapeShellArg "${name}_FILE=${file}"})
          '') launchdFileEnvironment)}
          $DRY_RUN_CMD /usr/bin/env "''${env_args[@]}" "${cfg.package}/bin/linear-gsuite" launchd install sync \
            --config ${lib.escapeShellArg cfg.calendar.packageFile} || true
        fi
      ''
    );
  };
}
