import { HttpCache } from "@deno/cache-dir";

type UrlFile = {
  url: string;
  out_path: string;
  headers?: Record<string, string>;
};
type UrlFileMap = Array<UrlFile>;
type Config = {
  urlFileMap: UrlFileMap;
  cachePath: string;
  vendorPath: string;
};

function getConfig(): Config {
  const flagsParsed: {
    "url-file-map"?: string;
    "cache-path"?: string;
    "vendor-path"?: string;
  } = {
    "url-file-map": undefined,
    "cache-path": undefined,
    "vendor-path": undefined,
  };
  const flags = Object.keys(flagsParsed).map((v) => "--" + v);
  Deno.args.forEach((arg, index) => {
    if (flags.includes(arg) && Deno.args.length > index + 1) {
      flagsParsed[arg.replace(/^--/g, "") as keyof typeof flagsParsed] =
        Deno.args[index + 1];
    }
  });

  if (!flagsParsed["url-file-map"]) {
    throw "--url-file-map flag not set but required";
  }
  if (!flagsParsed["cache-path"]) {
    throw "--cache-path flag not set but required";
  }
  if (!flagsParsed["vendor-path"]) {
    throw "--vendor-path flag not set but required";
  }

  return {
    urlFileMap: JSON.parse(
      new TextDecoder("utf-8").decode(Deno.readFileSync(flagsParsed["url-file-map"])),
    ),
    cachePath: flagsParsed["cache-path"],
    vendorPath: flagsParsed["vendor-path"],
  };
}

async function createDenoCache(config: Config) {
  const httpCache = await HttpCache.create({
    root: config.cachePath,
    vendorRoot: config.vendorPath,
    readOnly: false,
  });

  for (const { url, out_path, headers } of config.urlFileMap) {
    httpCache.set(new URL(url), headers || {}, Deno.readFileSync(out_path));
  }
}

async function main() {
  const config = getConfig();
  await createDenoCache(config);
}

if (import.meta.main) {
  main();
}
