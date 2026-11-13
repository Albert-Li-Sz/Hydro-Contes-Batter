// HydroXCPCIO modification: use only adapter-supplied, bundled school logos.
import { DEFAULT_SCHOOL_LOGO } from './logos.js';

export function applySchoolLogos(contest) {
  const localLogo = (value) => typeof value === 'string' &&
    value.startsWith('/hydro-resolver/') ? value : DEFAULT_SCHOOL_LOGO;
  return {
    ...contest,
    organizations: (contest.organizations || []).map((org) => ({ ...org, logo: localLogo(org.logo) })),
    teams: (contest.teams || []).map((team) => ({ ...team, logo: localLogo(team.logo) })),
  };
}
