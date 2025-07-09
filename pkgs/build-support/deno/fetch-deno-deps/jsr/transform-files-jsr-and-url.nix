{
  lib,
  stdenvNoCC,
  deno,
  writeTextFile,
  callPackage,
}:
let
  makeUrlFileMapJson =
    allFiles:
    let
      partitionByHasDerivation = builtins.partition (file: file ? derivation) allFiles;
      filesWithDerivation = partitionByHasDerivation.right;
      filesWithoutDerivation = partitionByHasDerivation.wrong;

      urlFileMap = builtins.map (
        { url, outPath, ... }@args:
        let
          lines = lib.splitString "\r" (builtins.readFile "${outPath}-headers");
          lines' = builtins.map lib.strings.trim (builtins.filter (line: line != "" && line != "\n") lines);
          headers = builtins.listToAttrs (
            builtins.map (
              line:
              let
                keyValue = lib.splitString ": " line;
                keyValue' =
                  assert (builtins.length keyValue) == 2;
                  keyValue;
              in
              {
                name = builtins.elemAt keyValue' 0;
                value = builtins.elemAt keyValue' 1;
              }
            ) lines'
          );
        in
        {
          url = if args ? meta.original then args.meta.original.url else url;
          headers = headers;
          out_path = outPath; # using `outPath` does weird things with builtins.toJSON
        }
      ) filesWithoutDerivation;

      rest = builtins.map (
        { url, outPath, ... }@args:
        {
          url = if args ? meta.original then args.meta.original.url else url;
          out_path = outPath;
        }
      ) filesWithDerivation;
    in
    writeTextFile {
      name = "url-file-map.json";
      text = builtins.toJSON (urlFileMap ++ rest);
    };

  transformPackages =
    fileMapJson:
    stdenvNoCC.mkDerivation {
      pname = "deno_cache_dir";
      version = "0.1.0";

      src = ../deno;

      buildPhase = ''
        # mkdir -p $out/.deno
        mkdir -p $out/vendor
        deno run --allow-all ./main.ts --cache-path=$out/.deno --vendor-path=$out/vendor --url-file-map=${fileMapJson}
      '';

      nativeBuildInputs = [
        deno
      ];
    };
in
{
  inherit transformPackages makeUrlFileMapJson;
  transformJsrAndUrlPackages = allFiles: rec {
    urlFileMap = makeUrlFileMapJson allFiles;
    transformed = transformPackages urlFileMap;
  };
}
