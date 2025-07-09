{
  callPackage,
  stdenvNoCC,
  lib,
}:
let
  inherit (callPackage ./jsr/transform-files-jsr-and-https.nix { }) transformJsrAndHttpsPackages;
  inherit (callPackage ./npm/transform-files-npm.nix { }) transformNpmPackages;
  inherit (callPackage ./lib.nix { }) fetcher toPackagesFilesList;

  inherit (callPackage ./jsr/transform-lock-jsr.nix { }) makeJsrPackages;
  inherit (callPackage ./https/transform-lock-https.nix { }) makeHttpsPackages;
  inherit (callPackage ./npm/transform-lock-npm.nix { }) makeNpmPackages;
  inherit (callPackage ./parse-specifier.nix { }) parsePackageSpecifier;

  transformDenoLockV5 =
    denoLockParsed: topLevelHash:
    let
      jsrParsed = builtins.mapAttrs (name: value: {
        parsedPackageSpecifier = (parsePackageSpecifier name);
        hash = value.integrity;
      }) denoLockParsed.jsr;
      jsrPackages = lib.attrsets.optionalAttrs (builtins.hasAttr "jsr" denoLockParsed) (makeJsrPackages {
        inherit jsrParsed;
      });

      httpsParsed = denoLockParsed.remote;
      httpsPackages =
        lib.attrsets.optionalAttrs (builtins.hasAttr "remote" denoLockParsed)
          (makeHttpsPackages {
            inherit httpsParsed;
          });

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
      npmPackages = lib.attrsets.optionalAttrs (builtins.hasAttr "npm" denoLockParsed) (makeNpmPackages {
        inherit npmTopLevelPackages npmParsed;
      });
    in
    {
      jsr = jsrPackages;
      https = httpsPackages // {
        withOneHash = httpsPackages.withOneHash // {
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
        "default" =
          assert (lib.assertMsg false "deno lock version not supported");
          null;
      };
    in
    if transformers ? denoLockParsed.version then
      transformers."${denoLockParsed.version}" denoLockParsed hash
    else
      transformers."default";

in
{
  fetchDenoDeps =
    {
      denoLock,
      name ? "deno-deps",
      hash ? lib.fakeHash,
      denoDir ? ".deno",
      vendorDir ? "vendor",
      impureEnvVars ? "",
      oneHashFetcherArgs ? { },
      fetchurlArgs ? { },
    }:
    let
      transformedDenoLock = transformDenoLock { inherit denoLock hash; };

      fetched = builtins.mapAttrs (
        name: value:
        fetcher {
          inherit
            impureEnvVars
            oneHashFetcherArgs
            fetchurlArgs
            ;
          packages = transformedDenoLock."${name}";
        }
      ) transformedDenoLock;

      transformedPackages = {
        jsrAndHttps =
          (transformJsrAndHttpsPackages {
            inherit vendorDir denoDir;
            allFiles = (toPackagesFilesList fetched.jsr) ++ (toPackagesFilesList fetched.https);
          }).transformed;
        npm = (
          transformNpmPackages {
            inherit name denoDir;
            topLevelPackages = fetched.npm.withHashPerFile.meta.topLevelPackages;
            allPackages = toPackagesFilesList fetched.npm;
          }
        );
      };

      final = stdenvNoCC.mkDerivation {
        inherit name;

        src = null;
        unpackPhase = "true";

        buildPhase = ''
          mkdir -p $out;
          cp -r ${transformedPackages.jsrAndHttps}/${vendorDir} $out;
          cp -r ${transformedPackages.npm}/${denoDir} $out;
        '';
      };
    in
    {
      inherit
        transformedDenoLock
        fetched
        transformedPackages
        final
        ;
    };
}
