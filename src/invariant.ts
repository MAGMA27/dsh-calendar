/**
 * Invariant companion plugin (no assertions — nothing to check at runtime for
 * the scaffold). The package-invariants gate in the build expects this entry
 * so it can see the invariant surface in each package's own config.
 */

/** Provides no assertions: the plugin owns no cross-package runtime invariants yet. */
export function apply(): void {}
