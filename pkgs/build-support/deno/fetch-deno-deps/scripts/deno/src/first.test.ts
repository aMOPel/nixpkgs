// TODO: use Deno.serve to create mock server that serves a virtual filesystem or real filesystem
// make e2e tests that run a script, pass args, setup filefs before and expect certain filefs after
// wrap e2e tests in nix build, but make them executable outside nix-build too
//
// or use sws https://static-web-server.net/ to serve fs
// maybe have a integration-test.ts file that has a mapping of filename to file content,
// write those to disk before the test, start sws with root where the files were written.
//
// use something to compare expected output to real output, maybe a fancy diff cli
//
// expected output can be in a mapping of filename to file content, too and written to disk before the test
//
// like this we stay tech agnostic and only test the top level contract of a cli
//
// we avoid having large amounts of test files commit to git
//
// we can create multiple test cases
type Args = Array<string>;
type Vars = Record<string, string>;
type VirtualFile = {
  path: string;
  content: string;
  isReal: boolean;
};
type Fixture = {
  vars?: Vars;
  inputs: {
    args: Args;
    files: Array<VirtualFile>;
  };
  outputs: {
    actual?: Array<VirtualFile>;
    expected: Array<VirtualFile>;
    prepFn: (...args: any[]) => any;
  };
};
const lockfileTransformerFixtures: Array<Fixture> = [
  (() => {
    const vars: Vars = {
      "in-path": "./first-deno.lock",
      "out-path-jsr": "./jsr.json",
      "out-path-npm": "./npm.json",
      "out-path-https": "./https.json",
    };
    return {
      vars,
      inputs: {
        args: [
          "deno",
          "run",
          "--allow-all",
          "./src/lockfile-transformer/lockfile-transformer.ts",
          "--in-path",
          vars["in-path"],
          "--out-path-jsr",
          vars["out-path-jsr"],
          "--out-path-npm",
          vars["out-path-npm"],
          "--out-path-https",
          vars["out-path-https"],
        ],
        files: [
          {
            path: vars["in-path"],
            isReal: false,
            content: `
{
  "version": "5",
  "specifiers": {
    "jsr:@luca/cases@1.0.0": "1.0.0",
    "jsr:@std/cli@1.0.17": "1.0.17"
  },
  "jsr": {
    "@luca/cases@1.0.0": {
      "integrity": "b5f9471f1830595e63a2b7d62821ac822a19e16899e6584799be63f17a1fbc30"
    },
    "@std/cli@1.0.17": {
      "integrity": "e15b9abe629e17be90cc6216327f03a29eae613365f1353837fa749aad29ce7b"
    }
  },
  "workspace": {
    "dependencies": [
      "jsr:@luca/cases@1.0.0",
      "jsr:@std/cli@1.0.17"
    ]
  }
}
            `,
          },
        ],
      },
      outputs: {
        expected: [
          {
            path: vars["out-path-jsr"],
            isReal: false,
            content: JSON.stringify(
              JSON.parse(`
[
  {
    "url": "https://jsr.io/@luca/cases/1.0.0_meta.json",
    "hash": "b5f9471f1830595e63a2b7d62821ac822a19e16899e6584799be63f17a1fbc30",
    "hashAlgo": "sha256",
    "meta": {
      "registry": "jsr",
      "packageSpecifier": {
        "fullString": "@luca/cases@1.0.0",
        "registry": "jsr",
        "scope": "luc",
        "name": "cases",
        "version": "1.0.0",
        "suffix": null
      }
    }
  },
  {
    "url": "https://jsr.io/@std/cli/1.0.17_meta.json",
    "hash": "e15b9abe629e17be90cc6216327f03a29eae613365f1353837fa749aad29ce7b",
    "hashAlgo": "sha256",
    "meta": {
      "registry": "jsr",
      "packageSpecifier": {
        "fullString": "@std/cli@1.0.17",
        "registry": "jsr",
        "scope": "std",
        "name": "cli",
        "version": "1.0.17",
        "suffix": null
      }
    }
  }
]
            `),
              null,
              2,
            ),
          },
        ],
        prepFn: JSON.parse,
      },
    };
  })(),
];

const enc = new TextEncoder();
const dec = new TextDecoder();

async function virtualFileToFs(f: VirtualFile) {
  if (f.isReal) {
    return;
  }
  await Deno.writeFile(f.path, enc.encode(f.content));
}

async function fsToVirtualFile(path: string): Promise<VirtualFile> {
  return {
    path,
    content: dec.decode(await Deno.readFile(path)),
    isReal: true,
  };
}

function argsToCommand(args: Args, restOptions?: any): Deno.Command {
  return new Deno.Command(args[0], {
    args: args.slice(1),
    ...restOptions,
  });
}

async function argsToPipe(
  ...argss: Args[]
): Promise<{ statuses: Deno.CommandStatus[]; output: Deno.CommandOutput }> {
  if (argss.length < 2) {
    throw "to few commands";
  }

  const cmds = argss.map((args) =>
    argsToCommand(args, {
      stdin: "piped",
      stdout: "piped",
    })
  );

  const processes = cmds.map((cmd) => cmd.spawn());
  processes.forEach((p, i, arr) => {
    if (i >= (arr.length - 1)) {
      return;
    }
    p.stdout.pipeTo(arr[i + 1].stdin);
  });

  processes[0].stdin?.close();

  return {
    statuses: await Promise.all(processes.map(async (p) => {
      return await p.status;
    })),
    output: await processes.at(-1)!.output(),
  };
}

function deepEquals(a: any, b: any, visited = new WeakMap()): boolean {
  // Handle identical values (including NaN)
  if (Object.is(a, b)) return true;

  // Handle null or primitive types
  if (
    typeof a !== "object" || a === null || typeof b !== "object" || b === null
  ) {
    return false;
  }

  // Prevent infinite recursion on circular refs
  if (visited.has(a)) {
    return visited.get(a) === b;
  }
  visited.set(a, b);

  // Handle Arrays
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((val, i) => deepEquals(val, b[i], visited));
  }

  // Handle general objects
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEquals(a[key], b[key], visited)) return false;
  }

  return true;
}

async function fancyDiff(f1: VirtualFile, f2: VirtualFile) {
  if (f1.path === f2.path) {
    f2.path += ".other";
  }
  await virtualFileToFs(f1);
  await virtualFileToFs(f2);
  const { output: { stdout }, statuses } = await argsToPipe([
    "diff",
    "-u",
    f1.path,
    f2.path,
  ], ["diff-so-fancy"]);
  console.log(dec.decode(stdout));
  assertEq(statuses[0].code, 0, "diff exited with non-zero");
}

function assertEq(a: any, b: any, msg?: string) {
  if (!deepEquals(a, b)) {
    const _msg = `Assertion failed: "${a}" === "${b}"\r\n`;
    throw new Error(_msg + msg);
  }
}

async function test(f: Fixture) {
  await Promise.all(f.inputs.files.map(virtualFileToFs));

  const command = argsToCommand(f.inputs.args);
  const { code, stdout, stderr } = await command.output();
  assertEq(code, 0, dec.decode(stderr));
  console.log(dec.decode(stdout));

  f.outputs.actual = await Promise.all(
    f.outputs.expected.map(async (f) => await fsToVirtualFile(f.path)),
  );

  await Promise.all(f.outputs.expected.map(async (expected, i) => {
    const actual = f.outputs.actual![i];
    await fancyDiff(actual, expected);
    // assertEq(
    //   f.outputs.prepFn(actual.content),
    //   f.outputs.prepFn(expected.content),
    // );
  }));
}

Deno.test({
  name: "first",
  fn: async () => await test(lockfileTransformerFixtures[0]),
});

// export async function startMockServer(
//   dir: string,
//   port = 8080,
// ): Promise<{ stop: () => void; url: string }> {
//   const controller = new AbortController();
//
//   const server = Deno.serve(
//     {
//       hostname: "127.0.0.1",
//       port,
//       signal: controller.signal,
//     },
//     async (req: Request): Promise<Response> => {
//       try {
//         const url = new URL(req.url);
//         const path = decodeURIComponent(url.pathname.slice(1)); // remove leading '/'
//         const filePath = `${dir}/${path}`;
//
//         const file = await Deno.open(filePath, { read: true });
//         const stat = await file.stat();
//         const headers = new Headers();
//         headers.set("content-length", stat.size.toString());
//         headers.set("content-type", detectContentType(filePath));
//         return new Response(file.readable, { status: 200, headers });
//       } catch {
//         return new Response("Not Found", { status: 404 });
//       }
//     }
//   );
//
//   return {
//     stop: () => controller.abort(),
//     url: `http://127.0.0.1:${port}`,
//   };
// }
//
// function detectContentType(path: string): string {
//   if (path.endsWith(".txt")) return "text/plain";
//   if (path.endsWith(".json")) return "application/json";
//   if (path.endsWith(".html")) return "text/html";
//   if (path.endsWith(".zip")) return "application/zip";
//   return "application/octet-stream";
// }
