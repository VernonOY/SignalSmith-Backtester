export const getBaseRem = (): number => {
  if (typeof window === "undefined") {
    return 16;
  }
  const size = parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
  return Number.isFinite(size) ? size : 16;
};
