export function addPrefix(p: PathString, prefix: PathString): PathString {
  return prefix !== "" ? prefix + "/" + p : p;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    } else {
      throw err;
    }
  }
}

export function getScopedName(packageSpecifier: PackageSpecifier): string {
  const withScope = `@${packageSpecifier.scope}/${packageSpecifier.name}`;
  const withoutScope = packageSpecifier.name;
  return packageSpecifier.scope != null ? withScope : withoutScope;
}

export function getScopedNameVersion(
  packageSpecifier: PackageSpecifier,
): string {
  return `${getScopedName(packageSpecifier)}@${packageSpecifier.version}`;
}

export function getRegistryScopedNameVersion(
  packageSpecifier: PackageSpecifier,
): string {
  const withRegistry = `${packageSpecifier.registry}:${getScopedNameVersion(packageSpecifier)}`;
  const withoutRegistry = getScopedNameVersion(packageSpecifier);
  return packageSpecifier.registry != null ? withRegistry : withoutRegistry;
}
