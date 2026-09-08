import type { ParsedTenderRow } from './types.js';
/**
 * A stable content fingerprint of a grid row's mutable fields - everything that can change
 * while a process keeps the same numeroProceso and estado. Excludes numeroProceso (identity)
 * and linkTarget (internal postback plumbing, never pushed). Free to compute: every field is
 * already present in the grid row this actor walks every run, no extra request needed.
 */
export declare function fingerprintOf(row: ParsedTenderRow): string;
//# sourceMappingURL=fingerprint.d.ts.map