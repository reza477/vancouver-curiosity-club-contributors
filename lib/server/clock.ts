import "server-only";

/**
 * Keeps wall-clock reads at the server boundary instead of inside React
 * render logic. Tests pass explicit clocks to the underlying sync services.
 */
export function readServerUtcMs() {
  return Date.now();
}
