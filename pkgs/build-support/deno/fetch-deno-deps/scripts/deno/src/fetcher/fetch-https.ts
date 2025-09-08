import { fetchDefault } from "./fetch-default.ts";

export async function fetchAllHttps(
  outPathPrefix: PathString,
  commonLockfileHttps: CommonLockFormatIn,
): Promise<CommonLockFormatOut> {
  let result: CommonLockFormatOut = [];
  const resultUnresolved = commonLockfileHttps.map((p)=>fetchDefault(outPathPrefix, p))

  await Promise.all(resultUnresolved).then((packageFiles) => {
    const fixedUrlPackageFiles = packageFiles.map((p) => {
      if (p?.meta?.original_url) {
        p.url = p.meta.original_url;
      }
      return p;
    });
    result = result.concat(fixedUrlPackageFiles);
  });
  return result;
}
