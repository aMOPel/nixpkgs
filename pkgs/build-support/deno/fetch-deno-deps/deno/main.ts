import { HttpCache } from "@deno/cache-dir";
import { parseArgs } from "@std/cli/parse-args";

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
  const flags = parseArgs(Deno.args, {
    string: ["url-file-map", "cache-path", "vendor-path"],
  });

  if (!flags["url-file-map"]) {
    throw "--url-file-map flag not set but required";
  }
  if (!flags["cache-path"]) {
    throw "--cache-path flag not set but required";
  }
  if (!flags["vendor-path"]) {
    throw "--vendor-path flag not set but required";
  }

  return {
    urlFileMap: JSON.parse(
      new TextDecoder("utf-8").decode(Deno.readFileSync(flags["url-file-map"]))
    ),
    cachePath: flags["cache-path"],
    vendorPath: flags["vendor-path"],
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
  await createDenoCache(config)
}

if (import.meta.main) {
  main();
}
