// TODO: use the hashes from the lockfile to verify integrity of downloads,
// the problem is that the hashes use different encoding schemes, while `fetch`
// expects a specific one, so some translation needs to happen, without any from the network.

import { fetchDefaultWithTypes } from "./fetch-default.ts";
import { fetchJsr } from "./fetch-jsr.ts";
import { fetchNpm } from "./fetch-npm.ts";
import { addPrefix, getRegistryScopedNameVersion } from "../utils.ts";

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
      new TextDecoder().decode(Deno.readFileSync(flagsParsed["in-path"])),
    ),
    outPathVendored: flagsParsed["out-path-vendored"],
    outPathNpm: flagsParsed["out-path-npm"],
    inPath: flagsParsed["in-path"],
    outPathPrefix: flagsParsed["out-path-prefix"] || "",
  };
}

type Lockfiles = { vendor: CommonLockFormatOut; npm: CommonLockFormatOut };
async function fetchAll(config: Config): Promise<Lockfiles> {
  const fetchers: Record<
    string,
    (c: Config, p: PackageFileIn) => Promise<Array<PackageFileOut>>
  > = {
    jsr: fetchJsr,
    npm: fetchNpm,
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
    const packageSpecifier = packageFile?.meta?.packageSpecifier;
    const nameOrUrl = packageSpecifier
      ? getRegistryScopedNameVersion(packageSpecifier)
      : packageFile.url;
    console.log(`fetching ${nameOrUrl}`);
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
