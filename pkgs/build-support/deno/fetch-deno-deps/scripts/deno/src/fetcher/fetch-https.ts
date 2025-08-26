import { fetchDefault } from "./fetch-default.ts";

type Config = SingleFodFetcherConfig;
export async function fetchAllHttps(
  config: Config,
): Promise<CommonLockFormatOut> {
  let result: CommonLockFormatOut = [];
  const resultUnresolved = config.commonLockfileHttps.map((p)=>fetchDefault(config, p))

  await Promise.all(resultUnresolved).then((packageFiles) => {
    const fixedUrlPackageFiles = packageFiles.map((p) => {
      if (p?.meta?.original) {
        p.url = p.meta.original.url;
      }
      return p;
    });
    result = result.concat(fixedUrlPackageFiles);
  });
  return result;
}
