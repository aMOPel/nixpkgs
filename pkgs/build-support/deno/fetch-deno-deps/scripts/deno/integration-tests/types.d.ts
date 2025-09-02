export type Args = Array<string>;
export type Vars = Record<string, string>;
export type VirtualFile = {
  path: string;
  content: string;
  isReal: boolean;
};
export type Fixture = {
  vars?: Vars;
  inputs: {
    args: Args;
    files: Array<VirtualFile>;
  };
  outputs: {
    actual?: Array<VirtualFile>;
    expected: Array<VirtualFile>;
  };
};
export type Test = {
  name: string;
  fixture: Fixture;
};
