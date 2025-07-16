type Config = LockfileTransformerConfig
function getConfig(): Config {
  const flagsParsed = {
    "in-path": "",
    "out-path": "",
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
    lockfile: JSON.parse(
      new TextDecoder("utf-8").decode(
        Deno.readFileSync(flagsParsed["in-path"]),
      ),
    ),
    outPath: flagsParsed["out-path"],
    inPath: flagsParsed["in-path"],
  };
}

function parsePackageSpecifier(fullString: string): PackageSpecifier {
  const matches = fullString.match(/^((.+):)?(@(.+)\/)?(.+)$/);
  if (!matches) {
    throw new Error(`Invalid package specifier: ${fullString}`);
  }
  const registry = matches[2] || null;
  const scope = matches[4] || null;
  const nameVersionSuffix = matches[5];
  const split = nameVersionSuffix.split("_");
  const nameVersionMatch = split[0].match(/^(.+)@(.+)$/);
  if (!nameVersionMatch) {
    throw new Error(`Invalid name@version format in: ${split[0]}`);
  }
  const name = nameVersionMatch[1];
  const version = nameVersionMatch[2];
  const suffix = split.length === 1 ? null : split.slice(1).join("_");
  return { fullString, registry, scope, name, version, suffix };
}

function makeVersionMetaJsonUrl(packageSpecifier: PackageSpecifier): UrlString {
  return `https://jsr.io/@${packageSpecifier.scope}/${packageSpecifier.name}/${packageSpecifier.version}_meta.json`;
}

function makeNpmPackageUrl(packageSpecifier: PackageSpecifier): UrlString {
  const withScope = `https://registry.npmjs.org/@${packageSpecifier.scope}/${packageSpecifier.name}/-/${packageSpecifier.name}-${packageSpecifier.version}.tgz`;
  const withoutScope = `https://registry.npmjs.org/${packageSpecifier.name}/-/${packageSpecifier.name}-${packageSpecifier.version}.tgz`;
  return packageSpecifier.scope === null ? withoutScope : withScope;
}

function makeJsrCommonLock(denolock: DenoLock): CommonLockFormatIn {
  const result: CommonLockFormatIn = [];
  Object.entries(denolock.jsr).forEach(([key, value]) => {
    const packageSpecifier = parsePackageSpecifier(key);
    const registry = "jsr";
    packageSpecifier.registry = registry;
    const url = makeVersionMetaJsonUrl(packageSpecifier);
    const hash = value.integrity;
    const hashAlgo = "sha256";
    result.push({
      url,
      hash,
      hashAlgo,
      meta: {
        registry,
        packageSpecifier,
      },
    });
  });
  return result;
}

function makeNpmCommonLock(denolock: DenoLock): CommonLockFormatIn {
  const result: CommonLockFormatIn = [];
  Object.entries(denolock.npm).forEach(([key, value]) => {
    const packageSpecifier = parsePackageSpecifier(key);
    const registry = "npm";
    packageSpecifier.registry = registry;
    const url = makeNpmPackageUrl(packageSpecifier);
    const hash = value.integrity;
    const hashAlgo = "sha512";
    result.push({
      url,
      hash,
      hashAlgo,
      meta: {
        registry,
        packageSpecifier,
      },
    });
  });
  return result;
}

function getRegistry(url: UrlString): string {
  return new URL(url).host;
}

function transformHttpsPackageFile(p: PackageFileIn): PackageFileIn {
  const transformers: Record<string, (p: PackageFileIn) => PackageFileIn> = {
    "esm.sh": function (p: PackageFileIn): PackageFileIn {
      const result = structuredClone(p);
      const url = new URL(result.url);
      if (!url.searchParams.has("target")) {
        url.searchParams.set("target", "denonext");
      }
      result.url = url.toString();
      return result;
    },
    default: function (p: PackageFileIn): PackageFileIn {
      return p;
    },
  };
  function pickTransformer(p: PackageFileIn): PackageFileIn {
    const transformer =
      transformers[p.meta.registry] || transformers["default"];
    return transformer(p);
  }
  return pickTransformer(p);
}

function makeHttpsCommonLock(denolock: DenoLock): CommonLockFormatIn {
  const result: CommonLockFormatIn = [];
  Object.entries(denolock.remote).forEach(([url, hash]) => {
    const registry = getRegistry(url);
    const hashAlgo = "sha256";
    result.push(
      transformHttpsPackageFile({
        url,
        hash,
        hashAlgo,
        meta: {
          registry,
        },
      }),
    );
  });
  return result;
}

function transformLock(denolock: DenoLock): CommonLockFormatIn {
  let result: CommonLockFormatIn = [];
  result = result.concat(makeJsrCommonLock(denolock));
  result = result.concat(makeNpmCommonLock(denolock));
  result = result.concat(makeHttpsCommonLock(denolock));
  return result;
}

function main() {
  const config = getConfig();
  const transformedLock = transformLock(config.lockfile);
  Deno.writeTextFileSync(config.outPath, JSON.stringify(transformedLock));
}

if (import.meta.main) {
  main();
}
