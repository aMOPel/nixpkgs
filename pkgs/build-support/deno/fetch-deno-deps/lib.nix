{
  stdenvNoCC,
  curl,
  cacert,
  lib,
  fetchurl,
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

  singleFodFetcher =
    {
      hash,
      packagesFiles,
      ...
    }@withOneHash:
    let
      derivation = stdenvNoCC.mkDerivation {
        pname = "fetcher";
        version = "0";

        src = null;
        unpackPhase = "true";

        nativeBuildInputs = [
          curl
        ];
        buildPhase =
          ''
            mkdir -p $out;

          ''
          + (makeCurlCommands packagesFiles);

        SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";

        outputHashMode = "recursive";
        outputHash = hash;
        outputHashAlgo = "sha256";
      };
      packagesFiles' = builtins.map (addOutPath "${derivation}") packagesFiles;
    in
    withOneHash
    // {
      inherit derivation;
      packagesFiles = packagesFiles';
    };

  fetchPackageFile =
    file:
    let
      derivation = fetchurl {
        url = file.url;
        hash = file.hash;
      };
    in
    file
    // {
      inherit derivation;
      outPath = "${derivation}";
    };

  toOneList =
    args:
    (lib.optionals (args ? preFetched) args.preFetched.packagesFiles)
    ++ (lib.optionals (args ? withOneHash) args.withOneHash.packagesFiles)
    ++ (lib.optionals (args ? withHashPerFile) args.withHashPerFile.packagesFiles);

  mergeAllPackagesFiles =
    argsList:
    let
      merge =
        key:
        builtins.concatLists (
          builtins.map (args: lib.attrsets.attrByPath [ "${key}" "packagesFiles" ] [ ] args) argsList
        );
    in
    builtins.mapAttrs (name: value: { packagesFiles = merge name; }) {
      preFetched = null;
      withHashPerFile = null;
      withOneHash = null;
    };

  fetcher =
    args:
    let
      hasWithHashPerFile = args ? withHashPerFile;
      hasWithOneHash = args ? withOneHash;
      hasTopLevelHash = args.withOneHash ? hash;
      hasPackages = args.withOneHash.packagesFiles != { };

      withSingleFod = lib.optionalAttrs (hasWithOneHash && hasTopLevelHash && hasPackages) {
        withOneHash = singleFodFetcher args.withOneHash;
      };
      withFodPerFile = lib.optionalAttrs hasWithHashPerFile {
        withHashPerFile = args.withHashPerFile // {
          packagesFiles = builtins.map fetchPackageFile args.withHashPerFile.packagesFiles;
        };
      };

    in
    args // withSingleFod // withFodPerFile;

in
{
  inherit
    fetcher
    urlToPath
    fixHash
    toOneList
    mergeAllPackagesFiles
    ;
}
