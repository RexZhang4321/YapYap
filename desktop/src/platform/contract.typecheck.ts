// Check all implementations, even when only one is bundled. No runtime code.
type Contract = typeof import("./platform.d.ts");
type Implements<T extends Contract> = T;
export type WindowsContract = Implements<
  typeof import("./platform.windows.ts")
>;
export type MacosContract = Implements<typeof import("./platform.macos.ts")>;
export type UnsupportedContract = Implements<
  typeof import("./platform.unsupported.ts")
>;
