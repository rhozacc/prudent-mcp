// The citation resolver's public surface. Everything else in this directory is
// internal to it; `src/file-adapter.ts` re-exports the names it always exported.
export { describedKindWindows, holdsKind } from "./described.ts";
export type { PointCheck } from "./points.ts";
export { textCarriesPoint } from "./points.ts";
export { resolveCitationDetailed, resolveCitationIn } from "./resolve.ts";
