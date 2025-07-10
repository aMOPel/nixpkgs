{
  stdenvNoCC,
  writeTextFile,
  gnutar,
}:
let
  # deno uses a subset of the json file available at `https://registry.npmjs.org/<packageName>` and calls it registry.json
  # here we construct a registry.json file from the information we have. we only use the bare minimum of necessary keys and values.
  makeRegistryJsonDerivation =
    parsedPackageSpecifier:
    writeTextFile {
      name = "registry.json";
      text = (
        builtins.toJSON {
          name = parsedPackageSpecifier.name;
          dist-tags = { };
          "_deno.etag" = "";
          versions."${parsedPackageSpecifier.version}" = {
            version = parsedPackageSpecifier.version;
            dist = {
              tarball = "";
            };
            bin = { };
          };
        }
      );
    };

  makeRegistryJsonPath =
    root: parsedPackageSpecifier: "${root}/${parsedPackageSpecifier.name}/registry.json";

  makeRegistryJsonCpCommand =
    root: parsedPackageSpecifier:
    let
      derivation = makeRegistryJsonDerivation parsedPackageSpecifier;
      path = makeRegistryJsonPath root parsedPackageSpecifier;
    in
    ''
      cp -r ${derivation} ${path};
    '';

  makeRegistryJsonCpCommands =
    root: topLevelPackages:
    builtins.concatStringsSep "\n" (builtins.map (makeRegistryJsonCpCommand root) topLevelPackages);

  makePackagePath =
    root: parsedPackageSpecifier:
    "${root}/${parsedPackageSpecifier.name}/${parsedPackageSpecifier.version}";

  makePackageCommand =
    root: file:
    let
      outPath = makePackagePath root file.meta.parsedPackageSpecifier;
    in
    ''
      mkdir -p ${outPath};
      tar -C ${outPath} -xzf ${file.outPath} --strip-components=1;
    '';

  makePackageCommands =
    root: allFiles:
    builtins.concatStringsSep "\n" (builtins.map (makePackageCommand root) allFiles);

  transformNpmPackages =
    {
      name,
      topLevelPackages,
      allFiles,
      denoDir,
    }:
    let
      root = "$out/${denoDir}/npm/registry.npmjs.org";
      cpCommands = makePackageCommands root allFiles;
      registryJsonCpCommands = makeRegistryJsonCpCommands root topLevelPackages;
    in
    stdenvNoCC.mkDerivation {
      name = "${name}-npm";

      src = null;
      unpackPhase = "true";

      buildPhase = '''' + cpCommands + registryJsonCpCommands;

      nativeBuildInputs = [
        gnutar
      ];
    };

in
{
  inherit transformNpmPackages;
}
