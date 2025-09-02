let
  inherit (import ../../../../default.nix { }) pkgs;

in
pkgs.mkShell {
  buildInputs = with pkgs; [
    deno
    rustup
    diff-so-fancy
  ];

  DENO_DIR = "./.deno";
  shellHook = '''';
}
