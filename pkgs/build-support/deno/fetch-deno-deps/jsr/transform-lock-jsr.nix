{
  lib,
  pkgs,
  fetchurl,
  callPackage,
}:
let

  inherit (callPackage ../lib.nix { }) mergeAllPackagesFiles fixHash;

  makeMetaJsonURL =
    parsedPackageSpecifier:
    "https://jsr.io/@${parsedPackageSpecifier.scope}/${parsedPackageSpecifier.name}/meta.json";

  makeVersionMetaJsonURL =
    parsedPackageSpecifier:
    "https://jsr.io/@${parsedPackageSpecifier.scope}/${parsedPackageSpecifier.name}/${parsedPackageSpecifier.version}_meta.json";

  makeJsrPackageFileUrl =
    parsedPackageSpecifier: filePath:
    "https://jsr.io/@${parsedPackageSpecifier.scope}/${parsedPackageSpecifier.name}/${parsedPackageSpecifier.version}${filePath}";

  fetchVersionMetaJson =
    parsedPackageSpecifier: hash:
    fetchurl {
      url = makeVersionMetaJsonURL parsedPackageSpecifier;
      hash = fixHash {
        inherit hash;
        algo = "sha256";
      };
    };

  makeVersionMetaJsonDerivation =
    parsedPackageSpecifier: hash: fetchVersionMetaJson parsedPackageSpecifier hash;

  makeMetaJsonDerivation =
    parsedPackageSpecifier:
    pkgs.writeTextFile {
      name = "meta.json";
      text = (
        builtins.toJSON {
          name = parsedPackageSpecifier.name;
          scope = parsedPackageSpecifier.scope;
          latest = parsedPackageSpecifier.version;
          versions."${parsedPackageSpecifier.version}" = { };
        }
      );
    };

  getFilesAndHashesUsingModuleGraph =
    parsedVersionMetaJson:
    let
      # instead of traversing the graph recursively, we just list the importers and the imported files and merge the lists
      moduleGraph =
        if parsedVersionMetaJson ? moduleGraph1 then
          parsedVersionMetaJson.moduleGraph1
        else if parsedVersionMetaJson ? moduleGraph2 then
          parsedVersionMetaJson.moduleGraph2
        else
          { };
      importers = builtins.attrNames moduleGraph;
      imported = lib.lists.flatten (
        builtins.attrValues (
          builtins.mapAttrs (
            name: value:
            let
              dependencies = if value ? dependencies then value.dependencies else [ ];
            in
            builtins.map (dep: lib.strings.removePrefix "." dep.specifier) dependencies
          ) moduleGraph
        )
      );
      # using attrset keys to do a union operation over lists of strings
      union =
        let
          a = builtins.listToAttrs (
            builtins.map (v: {
              name = v;
              value = 0;
            }) importers
          );
          b = builtins.listToAttrs (
            builtins.map (v: {
              name = v;
              value = 0;
            }) imported
          );
        in
        a // b;
    in
    builtins.mapAttrs (fileName: value: parsedVersionMetaJson.manifest."${fileName}".checksum) union;

  makeJsrPackage =
    { parsedPackageSpecifier, hash }:
    let
      metaJsonDerivation = makeMetaJsonDerivation parsedPackageSpecifier;
      versionMetaJsonDerivation = makeVersionMetaJsonDerivation parsedPackageSpecifier hash;
      parsedVersionMetaJson = builtins.fromJSON (builtins.readFile versionMetaJsonDerivation);
      filesAndHashes = getFilesAndHashesUsingModuleGraph parsedVersionMetaJson;
      packageFiles = builtins.attrValues (
        builtins.mapAttrs (filePath: hash2: {
          hash = fixHash {
            hash = hash2;
            algo = "sha256";
          };
          url = makeJsrPackageFileUrl parsedPackageSpecifier filePath;
          fileName = "/${parsedPackageSpecifier.version}${filePath}";
          meta = {
            inherit parsedPackageSpecifier;
          };
        }) filesAndHashes
      );
    in
    {
      preFetched = {
        packagesFiles = [
          {
            outPath = "${metaJsonDerivation}";
            derivation = metaJsonDerivation;
            url = makeMetaJsonURL parsedPackageSpecifier;
            fileName = "/meta.json";
            meta = {
              inherit parsedPackageSpecifier;
            };
          }
          {
            outPath = "${versionMetaJsonDerivation}";
            derivation = versionMetaJsonDerivation;
            url = makeVersionMetaJsonURL parsedPackageSpecifier;
            fileName = "/${parsedPackageSpecifier.version}_meta.json";
            meta = {
              inherit parsedPackageSpecifier;
            };
          }
        ];
      };

      withHashPerFile = {
        packagesFiles = packageFiles;
      };
    };

  makeJsrPackages =
    jsrParsed:
    let
      jsrPackages = builtins.attrValues (builtins.mapAttrs (name: value: makeJsrPackage value) jsrParsed);
    in
    mergeAllPackagesFiles jsrPackages;
in
{
  inherit makeJsrPackages;
}
