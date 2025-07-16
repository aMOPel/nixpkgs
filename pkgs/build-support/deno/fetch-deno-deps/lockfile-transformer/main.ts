type PackageFile = {
  url: string;
  hash: string;
  hashAlgo: string;
  meta?: any;
};
type CommonLockFormat = Array<PackageFile>;

type Config = {
  inPath: string;
  outPath: string;
  lockfile: DenoLock;
};

type RegistryPackageSpecifierString = string;
type PackageSpecifierString = string;
type VersionString = string;
type UrlString = string;
type Sha512String = string;
type Sha256String = string;

type NpmPackages = {
  [p: PackageSpecifierString]: {
    integrity: Sha512String;
    os?: Array<string>;
    cpu?: Array<string>;
    dependencies: Array<PackageSpecifierString>;
    optionalDependencies: Array<PackageSpecifierString>;
    bin?: boolean;
    scripts?: boolean;
  };
};
type JsrPackages = {
  [p: PackageSpecifierString]: {
    integrity: Sha256String;
    dependencies: Array<PackageSpecifierString>;
  };
};
type HttpsPackages = {
  [url: UrlString]: Sha256String;
};
// Rough type modelling of the lock file
type DenoLock = {
  specifiers: Record<RegistryPackageSpecifierString, VersionString>;
  version: "3" | "4" | "5";
  jsr: JsrPackages;
  npm: NpmPackages;
  redirects: {
    [p: UrlString]: UrlString;
  };
  remote: HttpsPackages;
  workspace: {
    dependencies: Array<RegistryPackageSpecifierString>;
  };
};

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

type PackageSpecifier = {
  fullString: string;
  registry: string | null;
  scope: string | null;
  name: string;
  version: string;
  suffix: string | null;
};

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

function makeJsrCommonLock(denolock: DenoLock): CommonLockFormat {
  const result: CommonLockFormat = [];
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

function makeNpmCommonLock(denolock: DenoLock): CommonLockFormat {
  const result: CommonLockFormat = [];
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

function transformHttpsPackageFile(p: PackageFile): PackageFile {
  const transformers: Record<string, (p: PackageFile) => PackageFile> = {
    "esm.sh": function (p: PackageFile): PackageFile {
      const result = structuredClone(p);
      const url = new URL(result.url);
      if (!url.searchParams.has("target")) {
        url.searchParams.set("target", "denonext");
      }
      result.url = url.toString();
      return result;
    },
    default: function (p: PackageFile): PackageFile {
      return p;
    },
  };
  function pickTransformer(p: PackageFile): PackageFile {
    const transformer =
      transformers[p.meta.registry] || transformers["default"];
    return transformer(p);
  }
  return pickTransformer(p);
}

function makeHttpsCommonLock(denolock: DenoLock): CommonLockFormat {
  const result: CommonLockFormat = [];
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

function transformLock(denolock: DenoLock): CommonLockFormat {
  let result: CommonLockFormat = [];
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
