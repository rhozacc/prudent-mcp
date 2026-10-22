/**
 * Stands in, in the bundled server only, for the MCP SDK's default JSON Schema validator.
 *
 * The SDK's `Server` constructs an Ajv-based validator by default, and uses it in exactly one place: to check
 * the answer to a form-elicitation request (the server asking the user a question through the client). This
 * server is read-only and never elicits, so that path cannot run. Bundling Ajv for it added about 260 KB of
 * code (Ajv, its formats, a URI parser) to a file that a reviewer has to read, and a handful of unrelated
 * URLs from Ajv's own meta-schemas. If this server ever elicits, remove the alias in `bundle-server.ts`.
 *
 * Same shape as the SDK class, so the import resolves; anything that does reach it fails loudly.
 */
export class AjvJsonSchemaValidator {
  getValidator(): never {
    throw new Error("prudent-mcp does not use elicitation: no JSON Schema validator is bundled");
  }
}
