// Ashdomes runtime profile:
// true: keep generation + navigation, skip cinematic/debug-heavy effects.
// false: original full visual stack.
export const RUNTIME_MINIMAL = true;

// Map generation profile for Ashdomes runtime.
// includeOceanSeeds=false favors one large landmass with smaller inland water bodies.
export const Ashdomes_MAP_PROFILE = {
  includeOceanSeeds: false,
  wfcMaxTries: 12,
  wfcMaxBacktracks: 5000,
};
