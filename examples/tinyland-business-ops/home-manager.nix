{ config, inputs, ... }:

let
  linearEnvName = "LINEAR_API_KEY";
in
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

      launchd.environmentFromFiles = builtins.listToAttrs [
        {
          name = linearEnvName;
          value = config.sops.secrets.linear-api-key.path;
        }
      ];
    };
  };
}
