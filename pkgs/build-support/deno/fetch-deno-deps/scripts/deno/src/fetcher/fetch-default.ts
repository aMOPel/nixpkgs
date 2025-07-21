import { addPrefix, getBasePath, isPath, normalizeUnixPath } from "../utils.ts";

type Config = SingleFodFetcherConfig;

// https://github.com/denoland/deno_cache_dir/blob/0.23.0/rs_lib/src/local.rs#L802
const keepHeaders = [
  "content-type",
  "location",
  "x-deno-warning",
  "x-typescript-types",
];

export async function makeOutPath(p: PackageFileIn): Promise<string> {
  const data = new TextEncoder().encode(p.url);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  const base64 = btoa(String.fromCharCode(...hashArray));
  return base64.replaceAll("/", "_");
}

export async function fetchDefault(
  config: Config,
  p: PackageFileIn,
  outPath_?: PathString,
): Promise<PackageFileOut> {
  let outPath = outPath_;
  if (outPath === undefined) {
    outPath = await makeOutPath(p);
  }
  const file = await Deno.open(addPrefix(outPath, config.outPathPrefix), {
    write: true,
    create: true,
    truncate: true,
  });
  console.log(`fetching ${p.url}`);
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

export async function fetchDefaultWithTypes(
  config: Config,
  p: PackageFileIn,
): Promise<Array<PackageFileOut>> {
  const result: Array<PackageFileOut> = [];
  const packageFileOut = await fetchDefault(config, p);
  result[0] = packageFileOut;

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

  const typesCache: Record<string, PackageFileOut> = {};
  async function recursivelyFetchTypes(url: string) {
    const typesPackageFile: PackageFileIn = {
      url,
      hash: "",
      hashAlgo: "sha256",
      meta: { from: structuredClone(p) },
    };

    if (Object.hasOwn(typesCache, url)) {
      return;
    }

    const fetched = await fetchDefault(config, typesPackageFile);
    result.push(fetched);
    typesCache[url] = fetched;

    const content = await Deno.readTextFile(
      addPrefix(result.at(-1)?.outPath as string, config.outPathPrefix),
    );
    const regex = /(?:"|')[a-zA-Z0-9_\.\-\/]+\.d\.ts(?:"|')/gm;
    const matches = content.match(regex);
    if (matches === null) {
      return;
    }
    const importedFiles = matches
      ?.map((v) => v.replaceAll(/"|'/g, ""))
      .map((v) => normalizeUnixPath(`${getBasePath(url)}/${v}`));

    const unresolved: Array<Promise<void>> = [];
    for (const url of importedFiles) {
      unresolved.push(recursivelyFetchTypes(url));
    }
    await Promise.all(unresolved);
  }
  recursivelyFetchTypes(url);
  return result;
}
