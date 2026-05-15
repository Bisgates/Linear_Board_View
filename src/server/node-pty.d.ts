// Minimal type shim for node-pty. Upstream ships types at
// `node_modules/node-pty/typings/node-pty.d.ts` but with our
// `types: ["node"]` + `moduleResolution: "Bundler"` config they're not
// auto-included. We only use a tiny surface area, so the shim stays small.

declare module "node-pty" {
  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: { [key: string]: string | undefined };
    encoding?: string | null;
  }

  export interface IPty {
    pid: number;
    process: string;
    write(data: string): void;
    resize(columns: number, rows: number): void;
    kill(signal?: string): void;
    onData(cb: (data: string) => void): { dispose(): void };
    onExit(cb: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  }

  export function spawn(
    file: string,
    args: string[] | string,
    options: IPtyForkOptions,
  ): IPty;
}
