// Markdown files imported `with { type: "text" }` (src/templates.ts) are strings.
declare module "*.md" {
  const text: string
  export default text
}
