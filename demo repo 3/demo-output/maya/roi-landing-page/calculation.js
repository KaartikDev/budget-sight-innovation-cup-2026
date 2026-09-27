/**
 * Illustrative time savings: each complete run replaces one task of the
 * supplied average duration; incomplete runs contribute no savings.
 */
export function estimateHoursSaved(runs, averageMinutes, incompleteRatePercent) {
  for (const value of [runs, averageMinutes, incompleteRatePercent]) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('Inputs must be finite, non-negative numbers.');
  }
  if (incompleteRatePercent > 100) throw new RangeError('Incomplete-run rate must be between 0 and 100.');
  return runs * averageMinutes * (1 - incompleteRatePercent / 100) / 60;
}
