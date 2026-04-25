{
  description = "@tummycrypt/linear-gsuite — Linear and Google Workspace automation toolkit";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    let
      sourceRevision = self.shortRev or self.dirtyShortRev or "unknown";
      sourceDirty = !(self ? rev);
      packageVersion = "0.1.0-dev+${sourceRevision}";
      overlay = final: prev: {
        linear-gsuite = final.callPackage ./nix/package.nix {
          version = packageVersion;
          buildRevision = sourceRevision;
          buildDirty = sourceDirty;
        };
      };
    in
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ overlay ];
        };
      in
      {
        packages.default = pkgs.linear-gsuite;
        packages.linear-gsuite = pkgs.linear-gsuite;

        apps.default = {
          type = "app";
          program = "${pkgs.linear-gsuite}/bin/linear-gsuite";
        };
        apps.linear-gsuite = {
          type = "app";
          program = "${pkgs.linear-gsuite}/bin/linear-gsuite";
        };

        checks.default = pkgs.linear-gsuite;

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bazel_8
            just
            nodejs_22
            pnpm_9
          ];

          shellHook = ''
            echo "linear-gsuite dev shell"
            echo "  node $(node --version)"
            echo "  pnpm $(pnpm --version)"
            echo "  just $(just --version)"
          '';
        };

        formatter = pkgs.nixfmt-rfc-style;
      }) // {
        overlays.default = overlay;
        homeManagerModules.default = import ./nix/modules/home-manager.nix;
      };
}
