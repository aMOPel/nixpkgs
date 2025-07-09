{
  callPackage,
  lib,
}:
let

  inherit (callPackage ./jsr/transform-lock-jsr.nix { }) makeJsrPackages;
  inherit (callPackage ./url/transform-lock-url.nix { }) makeUrlPackages;
  inherit (callPackage ./npm/transform-lock-npm.nix { }) makeNpmPackages;
  inherit (callPackage ./parse-specifier.nix { }) parsePackageSpecifier;

  transformDenoLockV5 =
    denoLockParsed: topLevelHash:
    let
      jsrParsed = builtins.mapAttrs (name: value: {
        parsedPackageSpecifier = (parsePackageSpecifier name);
        hash = value.integrity;
      }) denoLockParsed.jsr;
      jsrPackages = lib.attrsets.optionalAttrs (builtins.hasAttr "jsr" denoLockParsed) (
        makeJsrPackages jsrParsed
      );

      urlParsed = denoLockParsed.remote;
      urlPackages = lib.attrsets.optionalAttrs (builtins.hasAttr "remote" denoLockParsed) (
        makeUrlPackages urlParsed
      );

      npmParsed = builtins.mapAttrs (name: value: {
        parsedPackageSpecifier = parsePackageSpecifier name;
        hash = value.integrity;
      }) denoLockParsed.npm;
      npmTopLevelPackages =
        builtins.filter (parsedPackageSpecifier: parsedPackageSpecifier.registry == "npm")
          (
            builtins.map (packageSpecifier: parsePackageSpecifier packageSpecifier) (
              builtins.attrNames denoLockParsed.specifiers
            )
          );
      npmPackages = lib.attrsets.optionalAttrs (builtins.hasAttr "npm" denoLockParsed) (
        makeNpmPackages npmTopLevelPackages npmParsed
      );
    in
    {
      jsr = jsrPackages;
      url = urlPackages // {
        withOneHash = urlPackages.withOneHash // {
          hash = topLevelHash;
        };
      };
      npm = npmPackages;
    };

  transformDenoLock =
    { denoLock, hash }:
    let
      denoLockParsed = builtins.fromJSON (builtins.readFile denoLock);
      transformers = {
        "5" = transformDenoLockV5;
      };
    in
    transformers."${denoLockParsed.version}" denoLockParsed hash;

  # a = {
  #   preFetched = filesSchema;
  #   withOneHash = filesSchema;
  #   withHashPerFile = filesSchema;
  # };

  # filesSchema = {
  #   hash = "";
  #   derivation = null;
  #   curlOpts = ""; # global curl opts
  #   packagesFiles = [
  #     {
  #       url = "<url>";
  #       outPath = toPath url; # transforms url into unique path within the derivation, maybe by creating a hash of the url
  #       derivation = null; # can be added in step 1., in which case nothing is downloaded in step 2.
  #       curlOpts = ""; # per file curl opts
  #       meta = { }; # object of arbitrary shape that is passed through
  #       packageName = "";
  #       fileName = "";
  #     }
  #     # ...
  #   ];
  # };

in
{
  inherit transformDenoLock;
}
