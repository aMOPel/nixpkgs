let
  pkgs = import ../../../../../../default.nix { };
in
pkgs.mkShell {
  buildInputs = [ pkgs.nodejs_24 ];
}
