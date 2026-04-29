// Type declarations for binary files imported as embedded assets via
// `with { type: "file" }`. Bun extracts the asset to a runtime path and the
// default export is that path string. Used by the generated takumi shim
// under node_modules/.cache/honeymux/.

declare module "*.node" {
  const path: string;
  export default path;
}

declare module "*.ttf" {
  const path: string;
  export default path;
}
