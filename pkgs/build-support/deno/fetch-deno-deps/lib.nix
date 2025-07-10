{
  stdenvNoCC,
  curl,
  cacert,
  lib,
  fetchurl,
  breakpointHook,
}:
let
  urlToPath = url: builtins.hashString "sha256" url;

  addOutPath = root: file: file // { outPath = "${root}/${urlToPath file.url}"; };

  keepHeaders = [
    "content-type"
    "location"
    "x-deno-warning"
    "x-typescript-types"
  ];

  headersToRegex =
    headers: builtins.concatStringsSep ''\|'' (builtins.map (header: "^${header}:") headers);

  makeCurlCommand =
    file:
    let
      filePath = urlToPath file.url;
      headersRegex = headersToRegex keepHeaders;
    in
    ''
      curl --location --max-redirs 20 --retry 3 --retry-all-errors --continue-at - --disable-epsv --cookie-jar cookies --user-agent "curl/$curlVersion Nixpkgs/$nixpkgsVersion" -D $out/${filePath}-headers -C - --fail "${file.url}" --output $out/"${filePath}";
      cat $out/${filePath}-headers | grep -i '${headersRegex}' > temp
      cat temp > "$out/${filePath}-headers" ;
    '';

  makeCurlCommands =
    packagesFiles: builtins.concatStringsSep "\n" (builtins.map makeCurlCommand packagesFiles);

  fixHash =
    { hash, algo }:
    let
      hashWithoutPrefix = lib.lists.last (lib.strings.splitString "-" hash);
      hash' = builtins.convertHash {
        hash = hashWithoutPrefix;
        toHashFormat = "sri";
        hashAlgo = algo;
      };
    in
    hash';

  oneHashFetcher =
    {
      impureEnvVars ? [ ],
      withOneHash,
      oneHashFetcherArgs,
    }:
    let
      hash_ =
        if withOneHash.hash != "" then
          { outputHash = withOneHash.hash; }
        else
          {
            outputHash = lib.fakeSha256;
            outputHashAlgo = "sha256";
          };

      derivation =
        stdenvNoCC.mkDerivation {
          pname = "fetcher";
          version = "0";

          src = null;
          unpackPhase = "true";

          nativeBuildInputs = [
            curl
            breakpointHook
          ];
          buildPhase =
            ''
              mkdir -p $out;

            ''
            + (makeCurlCommands withOneHash.packagesFiles);

          # impureEnvVars = lib.fetchers.proxyImpureEnvVars ++ impureEnvVars;

          SSL_CERT_FILE =
              "${cacert}/etc/ssl/certs/ca-bundle.crt";
            # if
            #   (
            #     hash_.outputHash == ""
            #     || hash_.outputHash == lib.fakeSha256
            #     || hash_.outputHash == lib.fakeSha512
            #     || hash_.outputHash == lib.fakeHash
            #   )
            # then
            #   "${cacert}/etc/ssl/certs/ca-bundle.crt"
            # else
            #   "/no-cert-file.crt";

          outputHashMode = "recursive";
          outputHash = withOneHash.hash;
          outputHashAlgo = "sha256";
        }
        # // (builtins.trace hash_.outputHash hash_)
        // oneHashFetcherArgs;

      packagesFiles' = builtins.map (addOutPath "${derivation}") withOneHash.packagesFiles;
    in
    withOneHash
    // {
      inherit derivation;
      packagesFiles = packagesFiles';
    };

  fetchPackageFile =
    { file, impureEnvVars, fetchurlArgs }:
    let
      derivation = fetchurl {
        url = file.url;
        hash = file.hash;
        netrcImpureEnvVars = impureEnvVars;
      } // fetchurlArgs;
    in
    file
    // {
      inherit derivation;
      outPath = "${derivation}";
    };

  toPackagesFilesList =
    packages:
    (lib.optionals (packages ? preFetched) packages.preFetched.packagesFiles)
    ++ (lib.optionals (packages ? withOneHash) packages.withOneHash.packagesFiles)
    ++ (lib.optionals (packages ? withHashPerFile) packages.withHashPerFile.packagesFiles);

  ## merges a list of packages
  ## `[ { withHashPerFile = ...; withOneHash = ...; } { withHashPerFile = ...; withOneHash = ...; } ... ]`
  ## to a single packages object `{ withHashPerFile = ...; withOneHash = ...; }`
  mergePackagesList =
    packagesList:
    let
      merge =
        key:
        builtins.concatLists (
          builtins.map (packages: lib.attrsets.attrByPath [ "${key}" "packagesFiles" ] [ ] packages) packagesList
        );
    in
    builtins.mapAttrs (name: value: { packagesFiles = merge name; }) {
      preFetched = null;
      withHashPerFile = null;
      withOneHash = null;
    };

  fetcher =
    {
      packages,
      impureEnvVars ? "",
      oneHashFetcherArgs ? { },
      fetchurlArgs ? { },
    }:
    let
      hasWithHashPerFile = packages ? withHashPerFile;
      hasWithOneHash = packages ? withOneHash;
      hasTopLevelHash = packages.withOneHash ? hash;
      hasPackages = packages.withOneHash.packagesFiles != { };

      withSingleFod = lib.optionalAttrs (hasWithOneHash && hasTopLevelHash && hasPackages) {
        withOneHash = oneHashFetcher {
          inherit impureEnvVars oneHashFetcherArgs;
          inherit (packages) withOneHash;
        };
      };
      withFodPerFile = lib.optionalAttrs hasWithHashPerFile {
        withHashPerFile = packages.withHashPerFile // {
          packagesFiles = builtins.map (
            file: fetchPackageFile { inherit file impureEnvVars fetchurlArgs; }
          ) packages.withHashPerFile.packagesFiles;
        };
      };

    in
    packages // withSingleFod // withFodPerFile;

in
{
  inherit
    fetcher
    urlToPath
    fixHash
    toPackagesFilesList
    mergePackagesList
    ;
}
