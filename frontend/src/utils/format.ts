const BASE_LOCALE = "en-US";

export const formatCurrency = (value: number | undefined | null, fractionDigits = 0) => {
  const numeric = Number.isFinite(value as number) ? (value as number) : 0;
  return new Intl.NumberFormat(BASE_LOCALE, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(numeric);
};

export const formatPercent = (value: number | undefined | null, fractionDigits = 2) => {
  const numeric = Number.isFinite(value as number) ? (value as number) : 0;
  return new Intl.NumberFormat(BASE_LOCALE, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(numeric);
};

export const formatNumber = (value: number | undefined | null, fractionDigits = 0) => {
  const numeric = Number.isFinite(value as number) ? (value as number) : 0;
  return new Intl.NumberFormat(BASE_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(numeric);
};

export const formatDateYYMMDD = (isoDate: string) => {
  if (!isoDate) return "";
  return isoDate.slice(2).replace(/-/g, "");
};
