/**
 * Standardized staleTime tiers for React Query.
 *
 * - CONFIG: Data that rarely changes (settings, profiles) — never refetched until invalidated.
 * - STANDARD: Default for most queries — balances freshness and network cost.
 * - FREQUENT: Data that changes often or is polled (process lists, download status).
 */
export const STALE_TIME = {
  /** Settings, engine profiles, workspace path — effectively static */
  CONFIG: Infinity,
  /** Issues, projects, changes — moderate refresh rate */
  STANDARD: 30_000,
  /** Polled data, live status — short freshness window */
  FREQUENT: 5_000,
} as const
