{
  callPackage,
  stdenvNoCC,
  lib,
  cacert,
}:
let
  inherit (callPackage ./scripts/deno/default.nix { }) fetch-deno-deps-scripts;

  transformDenoLock =
    {
      denoLock,
    }:
    stdenvNoCC.mkDerivation {
      name = "transformed-deno-lock";
      src = null;
      unpackPhase = "true";
      buildPhase = ''
        lockfile-transformer --in-path ${denoLock} --out-path $out
      '';
      nativeBuildInputs = [
        fetch-deno-deps-scripts
      ];
    };

  singleFodFetcher =
    {
      transformedDenoLock,
      vendorJsonName,
      npmJsonName,
      impureEnvVars ? [ ],
      denoLock,
      hash,
      name,
    }:
    stdenvNoCC.mkDerivation {
      inherit name;
      src = null;
      unpackPhase = "true";
      buildPhase = ''
        single-fod-fetcher --in-path ${transformedDenoLock} --out-path-prefix $out --out-path-vendored ${vendorJsonName} --out-path-npm ${npmJsonName};
        cp ${denoLock} $out/deno.lock
      '';
      nativeBuildInputs = [
        fetch-deno-deps-scripts
      ];

      impureEnvVars =
        lib.fetchers.proxyImpureEnvVars
        ++ [
          # This variable allows the user to pass additional options to curl
          "NIX_CURL_FLAGS"
        ]
        ++ impureEnvVars;

      SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";

      outputHashMode = "recursive";
      outputHash = hash;
      outputHashAlgo = "sha256";
    };

in
{
  fetchDenoDeps =
    {
      denoLock,
      name ? "deno-deps",
      hash ? lib.fakeHash,
      impureEnvVars ? "",
      vendorJsonName,
      npmJsonName,
    }:
    let
      transformedDenoLock = transformDenoLock { inherit denoLock; };

      fetched = singleFodFetcher {
        inherit
          denoLock
          transformedDenoLock
          hash
          impureEnvVars
          vendorJsonName
          npmJsonName
          name
          ;
      };
    in
    {
      inherit
        transformedDenoLock
        fetched
        fetch-deno-deps-scripts
        ;
    };
}
