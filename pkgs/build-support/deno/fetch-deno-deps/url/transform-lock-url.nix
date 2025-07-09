{
  lib,
  callPackage,
}:
let
  inherit (callPackage ../lib.nix { }) fixHash;

  getRegistry = url: builtins.elemAt (builtins.split "/" (lib.strings.removePrefix "https://" url)) 0;

  makeUrlPackageFile =
    {
      url,
      hash,
    }:
    let
      registry = getRegistry url;
      transformers = {
        "esm.sh" =
          {
            url,
            hash,
          }@args:
          {
            url = "${url}?target=denonext";
            meta = {
              original = args;
              inherit registry;
            };
          };
        "default" =
          {
            url,
            hash,
          }@args:
          {
            inherit url;
            meta = {
              original = args;
              inherit registry;
            };
          };
      };
      pickTransformer =
        registry:
        if builtins.hasAttr registry transformers then transformers."${registry}" else transformers.default;
    in
    (pickTransformer registry) {
      inherit url;
      hash = fixHash {
        inherit hash;
        algo = "sha256";
      };
    };

  makeUrlPackages = urlParsed: {
    withOneHash = {
      packagesFiles = builtins.attrValues (
        builtins.mapAttrs (url: hash: makeUrlPackageFile { inherit url hash; }) urlParsed
      );
    };
  };
in
{
  inherit makeUrlPackages;
}
