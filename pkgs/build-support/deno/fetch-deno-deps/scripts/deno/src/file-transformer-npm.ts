type Config = FileTransformerNpmConfig
function getConfig(): Config {
  const flagsParsed = {
    "in-path": "",
    "cache-path": "",
  };
  const flags = Object.keys(flagsParsed).map((v) => "--" + v);
  Deno.args.forEach((arg, index) => {
    if (flags.includes(arg) && Deno.args.length > index + 1) {
      flagsParsed[arg.replace(/^--/g, "") as keyof typeof flagsParsed] =
        Deno.args[index + 1];
    }
  });

  Object.entries(flagsParsed).forEach(([key, value]) => {
    if (value === "") {
      throw `--${key} flag not set but required`;
    }
  });

  return {
    commonLockfile: JSON.parse(
      new TextDecoder("utf-8").decode(
        Deno.readFileSync(flagsParsed["in-path"]),
      ),
    ),
    cachePath: flagsParsed["cache-path"],
    inPath: flagsParsed["in-path"],
    rootPath: `${flagsParsed["cache-path"]}/npm/registry.npmjs.org`,
  };
}

// deno uses a subset of the json file available at `https://registry.npmjs.org/<packageName>` and calls it registry.json
// here we construct a registry.json file from the information we have. we only use the bare minimum of necessary keys and values.
function makeRegistryJsonContent(packageSpecifier: PackageSpecifier) {
  return {
    name: packageSpecifier.name,
    "dist-tags": {},
    "_deno.etag": "",
    versions: {
      [packageSpecifier.version]: {
        version: packageSpecifier.version,
        dist: {
          tarball: "",
        },
        bin: {},
      },
    },
  };
}

function makeRegistryJsonPath(
  root: PathString,
  packageSpecifier: PackageSpecifier,
): PathString {
  const withScope = `${root}/@${packageSpecifier.scope}/${packageSpecifier.name}/registry.json`;
  const withoutScope = `${root}/${packageSpecifier.name}/registry.json`;
  return packageSpecifier.scope != null ? withScope : withoutScope;
}

function makePackagePath(
  root: PathString,
  packageSpecifier: PackageSpecifier,
): PathString {
  const withScope = `${root}/@${packageSpecifier.scope}/${packageSpecifier.name}/${packageSpecifier.version}`;
  const withoutScope = `${root}/${packageSpecifier.name}/${packageSpecifier.version}`;
  return packageSpecifier.scope != null ? withScope : withoutScope;
}

async function unpackPackage(
  config: Config,
  packageSpecifier: PackageSpecifier,
  fetcherOutPath: PathString,
) {
  const outPath = makePackagePath(config.rootPath, packageSpecifier);
  await Deno.mkdir(outPath, { recursive: true });
  const command = new Deno.Command("tar", {
    args: ["-C", outPath, "-xzf", fetcherOutPath, "--strip-components=1"],
  });
  await command.output();
}

async function writeRegistryJson(
  config: Config,
  packageSpecifier: PackageSpecifier,
) {
  const outPath = makeRegistryJsonPath(config.rootPath, packageSpecifier);
  const content = new TextEncoder().encode(
    JSON.stringify(makeRegistryJsonContent(packageSpecifier)),
  );
  await Deno.writeFile(outPath, content, { create: true });
}

async function transformFilesNpm(config: Config) {
  for await (const packageFile of config.commonLockfile) {
    const packageSpecifier = packageFile?.meta?.packageSpecifier;
    if (!packageSpecifier) {
      throw `packageSpecifier required but not found in ${JSON.stringify(packageFile)}`;
    }
    await unpackPackage(config, packageSpecifier, packageFile.outPath);
    await writeRegistryJson(config, packageSpecifier);
  }
}

async function main() {
  const config = getConfig();
  await transformFilesNpm(config);
}

if (import.meta.main) {
  main();
}
