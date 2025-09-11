{
  lib,
  stdenvNoCC,
  fetch-deno-deps-scripts,
  file-structure-transformer-vendor,
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
      deno test --allow-all ./src/fileStructureTransformerNpm.test.ts -- file-structure-transformer-npm
      deno test --allow-all ./src/fileStructureTransformerVendor.test.ts -- file-structure-transformer-vendor
      touch $out
    '';
    nativeBuildInputs = [
      deno
      fetch-deno-deps-scripts
      file-structure-transformer-vendor
      diff-so-fancy
      static-web-server
    ];
  };
}
