// Turns raw logger rows into what the charts show.

/** Metres per second to kilometres per hour. */
export function kmh(mps) {
  return mps * 3.6;
}

/** The logger sends tenths of a degree above -40 °C. */
export function packTemperature(raw) {
  return raw / 10 + 40;
}

export function average(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}
