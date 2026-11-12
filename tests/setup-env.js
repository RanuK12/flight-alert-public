// Tests de UI ajenos a cobertura corren sin filtro; los de cobertura fijan COVERAGE_FILE.
process.env.COVERAGE_FILE = 'off';
if (!process.env.PLAN_LIMITS_JSON) {
  process.env.PLAN_LIMITS_JSON = JSON.stringify({
    checkIntervalMin: 180,
    free: { maxActiveAlerts: 1, digestEnabled: true, instantTotalMax: 0, searchesPerMonth: 10 },
    trial: { maxActiveAlerts: 3, digestEnabled: true, days: 7 },
    pro: { maxActiveAlerts: 30, digestEnabled: true, instantPerDayMax: 5, days: 30 },
  });
}
if (!process.env.INSTANT_ALERTS_TRIAL_MAX_TOTAL) {
  process.env.INSTANT_ALERTS_TRIAL_MAX_TOTAL = '3';
}
