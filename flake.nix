{
  description = "DNS sync CLI for Pi-hole and Cloudflare";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        version = "0.0.2";

        # Map Nix system to binary name
        binaryName = {
          "x86_64-linux" = "domainarr-linux-x64";
          "aarch64-linux" = "domainarr-linux-arm64";
          "x86_64-darwin" = "domainarr-macos-x64";
          "aarch64-darwin" = "domainarr-macos-arm64";
        }.${system} or (throw "Unsupported system: ${system}");

        # Placeholder hashes - updated automatically by CI after release
        hashes = {
          "x86_64-linux" = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
          "aarch64-linux" = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
          "x86_64-darwin" = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
          "aarch64-darwin" = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
        };

        domainarr = pkgs.stdenv.mkDerivation {
          pname = "domainarr";
          inherit version;

          src = pkgs.fetchurl {
            url = "https://github.com/ryanbas21/domainarr/releases/download/v${version}/${binaryName}";
            hash = hashes.${system};
          };

          dontUnpack = true;

          installPhase = ''
            runHook preInstall
            install -D -m755 $src $out/bin/domainarr
            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "DNS sync CLI for Pi-hole and Cloudflare";
            homepage = "https://github.com/ryanbas21/domainarr";
            license = licenses.isc;
            mainProgram = "domainarr";
            platforms = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
          };
        };
      in
      {
        packages = {
          default = domainarr;
          domainarr = domainarr;
        };

        apps.default = flake-utils.lib.mkApp {
          drv = domainarr;
        };

        # Development shell - enter with `nix develop` or direnv
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            corepack_22
            git
          ];

          shellHook = ''
            echo "domainarr dev environment"
            echo "node: $(node --version)"
            echo "pnpm: $(pnpm --version 2>/dev/null || echo 'run: corepack enable pnpm')"
          '';
        };
      }
    );
}
