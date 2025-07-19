import { fetchDefault, makeOutPath } from "./fetch-default.ts";
import {
  addPrefix,
  fileExists,
  getScopedName,
  isPath,
  normalizeUnixPath,
} from "../utils.ts";

type Config = SingleFodFetcherConfig;
function makeJsrPackageFileUrl(
  packageSpecifier: PackageSpecifier,
  filePath: string,
): string {
  return `https://jsr.io/${getScopedName(packageSpecifier)}/${packageSpecifier.version}${filePath}`;
}

function makeMetaJsonUrl(packageSpecifier: PackageSpecifier): string {
  return `https://jsr.io/${getScopedName(packageSpecifier)}/meta.json`;
}

async function fetchVersionMetaJson(
  config: Config,
  versionMetaJson: PackageFileIn,
): Promise<PackageFileOut> {
  return await fetchDefault(config, versionMetaJson);
}

function makeMetaJsonContent(packageSpecifier: PackageSpecifier): MetaJson {
  if (!packageSpecifier.scope) {
    throw `jsr package has no scope ${JSON.stringify(packageSpecifier)}`;
  }

  return {
    name: packageSpecifier.name,
    scope: packageSpecifier.scope,
    latest: packageSpecifier.version,
    versions: { [packageSpecifier.version]: {} },
  };
}

// TODO: this will merge existing meta.json version, which is good,
// but it wont merge meta.packageSpecifiers, but override,
// and it will create 2 entries in final lockfile
// TODO: same for registry.json
async function makeMetaJson(
  config: Config,
  versionMetaJson: PackageFileIn,
  packageSpecifier: PackageSpecifier,
): Promise<PackageFileOut | null> {
  const metaJsonUrl = makeMetaJsonUrl(packageSpecifier);

  const metaJson: PackageFileOut = {
    url: metaJsonUrl,
    hash: "",
    hashAlgo: "sha256",
    outPath: "",
    meta: structuredClone(versionMetaJson.meta),
  };
  metaJson.outPath = await makeOutPath(metaJson);

  const content = makeMetaJsonContent(packageSpecifier);
  const path = addPrefix(metaJson.outPath, config.outPathPrefix);

  if (await fileExists(path)) {
    const existingMetaJson = JSON.parse(
      new TextDecoder().decode(await Deno.readFile(path)),
    );
    content.versions = { ...existingMetaJson.versions, ...content.versions };
    const data = new TextEncoder().encode(JSON.stringify(content));
    await Deno.writeFile(path, data, { create: true });
    return null;
  }

  const data = new TextEncoder().encode(JSON.stringify(content));
  await Deno.writeFile(path, data, { create: true });

  return metaJson;
}

async function getFilesAndHashesUsingModuleGraph(
  config: Config,
  versionMetaJson: PackageFileOut,
): Promise<Record<string, string>> {
  const parsedVersionMetaJson: VersionMetaJson = JSON.parse(
    await Deno.readTextFile(
      addPrefix(versionMetaJson.outPath, config.outPathPrefix),
    ),
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
  packageSpecifier: PackageSpecifier,
): Promise<Array<PackageFileOut>> {
  let result: Array<PackageFileOut> = [];
  const result2: Array<Promise<PackageFileOut>> = [];
  const files = await getFilesAndHashesUsingModuleGraph(
    config,
    versionMetaJson,
  );
  for (const [filePath, hash] of Object.entries(files)) {
    const packageFile: PackageFileIn = {
      url: makeJsrPackageFileUrl(packageSpecifier, filePath),
      hash,
      hashAlgo: "sha256",
      meta: { packageSpecifier },
    };
    result2.push(fetchDefault(config, packageFile));
  }
  result = await Promise.all(result)
  return result;
}

export async function fetchJsr(
  config: Config,
  versionMetaJson: PackageFileIn,
): Promise<Array<PackageFileOut>> {
  const packageSpecifier = versionMetaJson?.meta?.packageSpecifier;
  if (!packageSpecifier) {
    throw `packageSpecifier required but not found in ${JSON.stringify(versionMetaJson)}`;
  }
  let result: Array<PackageFileOut> = [];
  result[0] = await fetchVersionMetaJson(config, versionMetaJson);

  const metaJson = await makeMetaJson(
    config,
    versionMetaJson,
    packageSpecifier,
  );
  if (metaJson !== null) {
    result[1] = metaJson;
  }

  result = result.concat(
    await fetchJsrPackageFiles(config, result[0], packageSpecifier),
  );
  return result;
}
