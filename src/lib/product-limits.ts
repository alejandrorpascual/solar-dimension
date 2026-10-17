/**
 * Upper bounds that catch a slipped unit or digit; no real product comes near them. Apart from product-schema so the
 * quote checks, which run in the browser too, read them without loading the product schemas.
 */
export const PRODUCT_LIMITS = {
  WATTS: 100_000, VOLTS: 1000, AMPS: 2000, PERCENT: 100, YEARS: 30, CYCLES: 100_000, SECONDS: 3600, UNITS: 100, KWH: 1000, AH: 5000,
} as const
