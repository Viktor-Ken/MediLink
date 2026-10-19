function score(v) {
  return v == null ? null : Number(v);
}

export function ewsScore(v = {}) {
  const components = {};
  const { consciousness } = v;

  const rr = score(v.respiratory_rate);
  components.resp_rate = rr == null ? null : rr >= 25 ? 3 : rr >= 21 ? 2 : rr >= 12 ? 0 : rr >= 9 ? 1 : 3;

  const s = score(v.spo2);
  components.spo2 = s == null ? null : s >= 96 ? 0 : s >= 94 ? 1 : s >= 92 ? 2 : 3;

  const sbp = score(v.systolic);
  components.systolic = sbp == null ? null : sbp >= 220 ? 3 : sbp >= 111 ? 0 : sbp >= 101 ? 1 : sbp >= 91 ? 2 : 3;

  const hr = score(v.pulse);
  components.pulse = hr == null ? null : hr >= 131 ? 3 : hr >= 111 ? 2 : hr >= 91 ? 1 : hr >= 51 ? 0 : hr >= 41 ? 1 : 3;

  const t = score(v.temperature);
  components.temperature = t == null ? null : t >= 39.1 ? 2 : t >= 38.1 ? 1 : t >= 36.1 ? 0 : t >= 35.1 ? 1 : 3;

  components.consciousness =
    consciousness == null ? null : String(consciousness).toLowerCase() === 'alert' ? 0 : 3;

  const values = Object.values(components).filter((x) => x != null);
  const total = values.reduce((a, b) => a + b, 0);
  const risk =
    total >= 7 || values.some((x) => x === 3) ? 'high' : total >= 5 ? 'medium' : 'low';

  return { total, risk, components };
}