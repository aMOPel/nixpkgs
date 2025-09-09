{
  lib,
  stdenvNoCC,
  fetch-deno-deps-scripts,
  deno,
  diff-so-fancy,
  static-web-server,
}:
let
  denoJson = builtins.fromJSON (builtins.readFile ./deno.json);
in
{
  test-fetch-deno-deps-scripts = stdenvNoCC.mkDerivation {
    pname = denoJson.name;
    inherit (denoJson) version;
    src = lib.sourceFilesBySuffices ./. [ ".ts" ];
    DENO_DIR = "./.deno";
    buildPhase = ''
      deno test --allow-all ./src/lockfileTransformer.test.ts -- lockfile-transformer
      deno test --allow-all ./src/fetcher.test.ts -- single-fod-fetcher
      touch $out
    '';
    nativeBuildInputs = [
      deno
      fetch-deno-deps-scripts
      diff-so-fancy
      static-web-server
    ];
  };
}
