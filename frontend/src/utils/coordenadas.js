// "-1.4558, -48.5044", "https://maps.google.com/?q=-1.45,-48.50" ou ".../@-1.45,-48.50,17z" -> { latitude, longitude }
export function lerCoordenadas(texto) {
  const t = String(texto || "").trim();
  const m = t.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || t.match(/[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/)
    || t.match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const latitude = Number(m[1].replace(",", "."));
  const longitude = Number(m[2].replace(",", "."));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}
