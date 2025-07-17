import { fetchDefault, makeOutPath } from "./fetch-default.ts";
import { addPrefix, fileExists, getScopedName } from "../utils.ts";
type Config = SingleFodFetcherConfig;

function makeRegistryJsonUrl(packageSpecifier: PackageSpecifier): string {
  // not a real url, needs to be unique per scope+name, but not unique per version
  return `${getScopedName(packageSpecifier)}/registry.json`;
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

async function makeRegistryJson(
  config: Config,
  packageFile: PackageFileIn,
  packageSpecifier: PackageSpecifier,
): Promise<PackageFileOut> {
  const url = makeRegistryJsonUrl(packageSpecifier);

  const registryJson: PackageFileOut = {
    url,
    hash: "",
    hashAlgo: "sha256",
    outPath: "",
    meta: structuredClone(packageFile.meta),
  };
  registryJson.outPath = await makeOutPath(registryJson);

  const content = makeRegistryJsonContent(packageSpecifier);
  const path = addPrefix(registryJson.outPath, config.outPathPrefix);

  if (await fileExists(path)) {
    const existingRegistryJson = JSON.parse(
      new TextDecoder().decode(await Deno.readFile(path)),
    );
    content.versions = {
      ...existingRegistryJson.versions,
      ...content.versions,
    };
  }

  await Deno.writeFile(
    addPrefix(registryJson.outPath, config.outPathPrefix),
    new TextEncoder().encode(JSON.stringify(content)),
    { create: true },
  );

  return registryJson;
}

export async function fetchNpm(
  config: Config,
  packageFile: PackageFileIn,
): Promise<Array<PackageFileOut>> {
  const packageSpecifier = packageFile?.meta?.packageSpecifier;
  if (!packageSpecifier) {
    throw `packageSpecifier required but not found in ${JSON.stringify(packageFile)}`;
  }
  const result: Array<PackageFileOut> = [];
  result[0] = await fetchDefault(config, packageFile);
  result[1] = await makeRegistryJson(config, packageFile, packageSpecifier);
  return result;
}
