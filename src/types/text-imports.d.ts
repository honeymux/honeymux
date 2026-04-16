// Type declarations for non-TS files imported as text via `with { type: "text" }`.
// These are embedded at build time by Bun's bundler.

declare module "*.py" {
  const content: string;
  export default content;
}

declare module "*.source" {
  const content: string;
  export default content;
}
