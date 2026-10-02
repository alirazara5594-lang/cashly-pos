/**
 * The name a POS version is shown under.
 *
 * The top version is sold as "Enterprise". Its stored key stays "Professional" — in the database,
 * the API and every saved setting — so nothing already saved has to change; only what people read
 * does. Use this wherever a version key is put on screen.
 */
export const tierLabel = (tier?: string | null): string =>
  tier === 'Professional' ? 'Enterprise' : (tier ?? '');
