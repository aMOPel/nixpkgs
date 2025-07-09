{
  buildNpmPackage,
  importNpmLock,
  nix-gitignore,
  nodejs_24,
}:
{
  denoCacheDirWrapper = buildNpmPackage {
    pname = "deno-cache-dir-wrapper";
    version = "0.1.0";
    src = nix-gitignore.gitignoreSource [ ] ./.;
    dontNpmBuild = true;
    nodejs = nodejs_24;
    npmDeps = importNpmLock {
      npmRoot = ./.;
    };
    npmConfigHook = importNpmLock.npmConfigHook;
  };
}
