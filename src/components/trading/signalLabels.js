// Graded, human-readable labels for the indicator-derived signal shown on the
// Trading page. The underlying recommendation stays buy / sell / hold; the grade
// is derived from the confidence score so the label reflects the signal's
// strength, not just its direction.
export function getSignalLabel(recommendation, confidence) {
  const c = Number(confidence) || 0;

  if (recommendation === "buy") {
    if (c >= 88) return "Very Strong Buy";
    if (c >= 78) return "Strong Buy";
    return "Buy";
  }

  if (recommendation === "sell") {
    if (c <= 32) return "Very Strong Sell";
    if (c <= 42) return "Strong Sell";
    return "Sell";
  }

  return "Hold";
}