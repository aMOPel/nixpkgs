type Config = SingleFodFetcherConfig;
function getConfig(): Config {
  const flagsParsed = {
    "in-path": "",
    "out-path-vendored": "",
    "out-path-npm": "",
    "out-path-prefix": "",
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
    outPathVendored: flagsParsed["out-path-vendored"],
    outPathNpm: flagsParsed["out-path-npm"],
    inPath: flagsParsed["in-path"],
    outPathPrefix: flagsParsed["out-path-prefix"] || "",
  };
}

function addPrefix(p: PathString, prefix: PathString): PathString {
  return prefix !== "" ? prefix + "/" + p : p;
}

function makeJsrPackageFileUrl(
  packageSpecifier: PackageSpecifier,
  filePath: string,
): string {
  return `https://jsr.io/@${packageSpecifier.scope}/${packageSpecifier.name}/${packageSpecifier.version}${filePath}`;
}

function makeMetaJsonUrl(packageSpecifier: PackageSpecifier): string {
  return `https://jsr.io/@${packageSpecifier.scope}/${packageSpecifier.name}/meta.json`;
}

async function makeOutPath(p: PackageFileIn): Promise<string> {
  const data = new TextEncoder().encode(p.url);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  const base64 = btoa(String.fromCharCode(...hashArray));
  return base64.replaceAll("/", "_");
}

// https://github.com/denoland/deno_cache_dir/blob/0.23.0/rs_lib/src/local.rs#L802
const keepHeaders = [
  "content-type",
  "location",
  "x-deno-warning",
  "x-typescript-types",
];

async function fetchDefault(
  config: Config,
  p: PackageFileIn,
  outPath_?: PathString,
): Promise<PackageFileOut> {
  let outPath = outPath_;
  if (outPath === undefined) {
    outPath = await makeOutPath(p);
    outPath = addPrefix(outPath, config.outPathPrefix);
  }
  const file = await Deno.open(outPath, {
    write: true,
    create: true,
    truncate: true,
  });
  const response = await fetch(p.url);
  if (!response.ok) {
    throw `fetch to ${p.url} failed`;
  }
  let headers: Record<string, string> | undefined = undefined;

  for (const [key, value] of response.headers.entries()) {
    const keyLower = key.toLowerCase();
    if (keepHeaders.includes(keyLower)) {
      if (headers === undefined) {
        headers = {};
      }
      headers[keyLower] = value;
    }
  }

  await response.body?.pipeTo(file.writable);
  return {
    ...p,
    outPath,
    headers,
  };
}

async function fetchDefaultWithTypes(
  config: Config,
  p: PackageFileIn,
): Promise<Array<PackageFileOut>> {
  const result: Array<PackageFileOut> = [];
  const packageFileOut = await fetchDefault(config, p);
  result.push(packageFileOut);

  if (
    !packageFileOut?.headers ||
    (packageFileOut?.headers &&
      !Object.keys(packageFileOut?.headers).includes("x-typescript-types"))
  ) {
    return result;
  }

  const typesUrl = packageFileOut.headers["x-typescript-types"];
  let url = "";
  if (typesUrl.startsWith("https://")) {
    url = typesUrl;
  } else if (isPath(typesUrl)) {
    const parsedUrl = new URL(packageFileOut.url);
    parsedUrl.pathname = typesUrl.replace(/^\.\//, "/");
    url = parsedUrl.toString();
  } else {
    throw `unsupported x-typescript-types url: ${typesUrl}`;
  }
  const typesPackageFile: PackageFileIn = {
    url,
    hash: "",
    hashAlgo: "sha256",
    meta: structuredClone(p),
  };

  result.push(await fetchDefault(config, typesPackageFile));
  return result;
}

async function fetchVersionMetaJson(
  config: Config,
  versionMetaJson: PackageFileIn,
): Promise<PackageFileOut> {
  return await fetchDefault(config, versionMetaJson);
}

async function makeMetaJson(
  config: Config,
  versionMetaJson: PackageFileIn,
): Promise<PackageFileOut> {
  const packageSpecifier = versionMetaJson?.meta?.packageSpecifier;
  if (!packageSpecifier) {
    throw `packageSpecifier required but not found in ${JSON.stringify(versionMetaJson)}`;
  }
  const metaJsonUrl = makeMetaJsonUrl(packageSpecifier);

  const metaJson: PackageFileOut = {
    url: metaJsonUrl,
    hash: "",
    hashAlgo: "sha256",
    outPath: "",
    meta: structuredClone(versionMetaJson.meta),
  };
  metaJson.outPath = await makeOutPath(metaJson);
  metaJson.outPath = addPrefix(metaJson.outPath, config.outPathPrefix);

  const data = new TextEncoder().encode(
    JSON.stringify({
      name: packageSpecifier.name,
      scope: packageSpecifier.scope,
      latest: packageSpecifier.version,
      versions: { [packageSpecifier.version]: {} },
    }),
  );
  await Deno.writeFile(metaJson.outPath, data, { create: true });

  return metaJson;
}

function normalizeUnixPath(path: PathString): PathString {
  const segments = path.split("/");
  const stack = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (stack.length && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else {
        stack.push("..");
      }
    } else {
      stack.push(segment);
    }
  }
  const isAbsolute = path.startsWith("/");
  return (isAbsolute ? "/" : "") + stack.join("/");
}

function isPath(s: string): boolean {
  return s.startsWith("./") || s.startsWith("../") || s.startsWith("/");
}

async function getFilesAndHashesUsingModuleGraph(
  versionMetaJson: PackageFileOut,
): Promise<Record<string, string>> {
  const parsedVersionMetaJson: VersionMetaJson = JSON.parse(
    await Deno.readTextFile(versionMetaJson.outPath),
  );
  const moduleGraph =
    parsedVersionMetaJson["moduleGraph1"] ||
    parsedVersionMetaJson["moduleGraph2"];
  if (!moduleGraph) {
    throw `moduleGraph required but not found in ${JSON.stringify(parsedVersionMetaJson)}`;
  }
  const exports = parsedVersionMetaJson["exports"];
  if (!exports) {
    throw `exports required but not found in ${JSON.stringify(parsedVersionMetaJson)}`;
  }

  const importers = Object.keys(moduleGraph);
  const exporters = Object.values(exports).map((v) => v.replace(/^\.\//, "/"));
  const imported: Array<string> = [];
  Object.entries(moduleGraph).forEach(([importedFilePath, value]) => {
    const basePath = importedFilePath.split("/").slice(0, -1).join("/");
    value?.dependencies?.forEach((dependency) => {
      let specifier = "";
      switch (dependency.type) {
        case "static":
          specifier = dependency.specifier;
          break;
        case "dynamic":
          specifier = dependency.argument || "";
          break;
        default:
          throw `unsupported moduleGraph format in ${JSON.stringify(versionMetaJson)}:\n\n${moduleGraph}`;
      }
      if (!isPath(specifier)) {
        return;
      }
      imported.push(normalizeUnixPath(`${basePath}/${specifier}`));
    });
  });
  const all = importers.concat(exporters).concat(imported);

  const set = new Set(all);
  const result: Record<string, string> = {};
  Array.from(set).forEach(
    (fileName) =>
      (result[fileName] = parsedVersionMetaJson.manifest[fileName].checksum),
  );
  return result;
}

async function fetchJsrPackageFiles(
  config: Config,
  versionMetaJson: PackageFileOut,
): Promise<Array<PackageFileOut>> {
  const result: Array<PackageFileOut> = [];
  const packageSpecifier = versionMetaJson?.meta?.packageSpecifier;
  if (!packageSpecifier) {
    throw `packageSpecifier required but not found in ${JSON.stringify(versionMetaJson)}`;
  }
  const files = await getFilesAndHashesUsingModuleGraph(versionMetaJson);
  for await (const [filePath, hash] of Object.entries(files)) {
    const packageFile: PackageFileIn = {
      url: makeJsrPackageFileUrl(packageSpecifier, filePath),
      hash,
      hashAlgo: "sha256",
      meta: { packageSpecifier },
    };
    result.push(await fetchDefault(config, packageFile));
  }
  // if (versionMetaJson.meta.packageSpecifier.name === "astral") {
  //   console.log(result);
  // }
  return result;
}

async function fetchJsr(
  config: Config,
  versionMetaJson: PackageFileIn,
): Promise<Array<PackageFileOut>> {
  let result: Array<PackageFileOut> = [];
  result[0] = await fetchVersionMetaJson(config, versionMetaJson);
  result[1] = await makeMetaJson(config, versionMetaJson);
  result = result.concat(await fetchJsrPackageFiles(config, result[0]));
  return result;
}

type Lockfiles = { vendor: CommonLockFormatOut; npm: CommonLockFormatOut };
async function fetchAll(config: Config): Promise<Lockfiles> {
  const fetchers: Record<
    string,
    (c: Config, p: PackageFileIn) => Promise<Array<PackageFileOut>>
  > = {
    jsr: fetchJsr,
    npm: async (c: Config, p: PackageFileIn) => [await fetchDefault(c, p)],
    default: fetchDefaultWithTypes,
  };

  const lockfiles: Record<string, keyof Lockfiles> = {
    npm: "npm",
    default: "vendor",
  };

  const result: Lockfiles = {
    vendor: [],
    npm: [],
  };

  for await (const packageFile of config.commonLockfile) {
    const registry = packageFile?.meta?.registry;
    if (!registry) {
      throw `registry required but not given in '${JSON.stringify(packageFile)}'`;
    }
    const lockfile = lockfiles[registry] || lockfiles["default"];
    const fetcher = fetchers[registry] || fetchers["default"];
    result[lockfile] = result[lockfile].concat(
      await fetcher(config, packageFile),
    );
  }

  return result;
}

async function main() {
  const config = getConfig();
  await Deno.mkdir(config.outPathPrefix, { recursive: true });
  const lockfiles = await fetchAll(config);
  await Deno.writeTextFile(
    addPrefix(config.outPathVendored, config.outPathPrefix),
    JSON.stringify(lockfiles.vendor),
    { create: true },
  );
  await Deno.writeTextFile(
    addPrefix(config.outPathNpm, config.outPathPrefix),
    JSON.stringify(lockfiles.npm),
    { create: true },
  );
}

if (import.meta.main) {
  main();
}
