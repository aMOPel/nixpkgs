let
  inherit (import ../../../../default.nix { }) pkgs;

in
pkgs.mkShell {
  buildInputs = [ pkgs.deno ];

  DENO_DIR="./.deno";
  shellHook = ''
  '';
}
