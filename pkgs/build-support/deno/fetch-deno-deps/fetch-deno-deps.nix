{
  callPackage,
  stdenvNoCC,
}:
let
  inherit (callPackage ./transform-lock.nix { }) transformDenoLock;
  inherit (callPackage ./jsr/transform-files-jsr-and-url.nix { }) transformJsrAndUrlPackages;
  inherit (callPackage ./npm/transform-files-npm.nix { }) transformNpmPackages;
  inherit (callPackage ./lib.nix { }) fetcher toOneList;
in
{
  denoLock ? "./deno.lock",
  hash ? "",
}:
let
  transformedDenoLock = transformDenoLock { inherit denoLock hash; };

  fetched = builtins.mapAttrs (
    name: value: fetcher transformedDenoLock."${name}"
  ) transformedDenoLock;

  transformedPackages = {
    jsrAndUrl =
      (transformJsrAndUrlPackages ((toOneList fetched.jsr) ++ (toOneList fetched.url))).transformed;
    npm = (transformNpmPackages fetched.npm.withHashPerFile.meta.topLevelPackages (toOneList fetched.npm));
  };

  final = stdenvNoCC.mkDerivation {
    pname = "deno_cache_dir";
    version = "0.1.0";

    src = null;
    unpackPhase = "true";

    buildPhase = ''
      mkdir -p $out;
      cp -r ${transformedPackages.jsrAndUrl}/vendor $out;
      cp -r ${transformedPackages.npm}/.deno $out;
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
}
