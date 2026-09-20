-- Keep only the exact rate direction.
--
-- 1/280 does not fit in DECIMAL(18,8), so a stored DZD->EUR inverse of
-- 0.00357143 converted an 8,400,000 DZD customs bill to EUR 30,000.01 instead
-- of EUR 30,000.00. The reverse direction is now derived by division, which
-- keeps full precision, so the lossy rows are removed.
DELETE FROM "ExchangeRate" e
WHERE EXISTS (
  SELECT 1 FROM "ExchangeRate" o
  WHERE o."fromCurrency" = e."toCurrency"
    AND o."toCurrency"   = e."fromCurrency"
    AND o."validFrom"   <= e."validFrom"
    AND o."rate" >= 1
);
