-- Run in Supabase SQL editor.
--
-- pricing_master.cost_currency (and the MSRP currency columns) carry foreign
-- keys to exchange_rates. AED, SAR and QAR are offered in every currency
-- dropdown, but AED was deliberately never stored — fetchRates() pins it to 1
-- in the browser — so saving an item costed or priced in AED failed with
-- pricing_master_cost_currency_fkey. SAR and QAR were in the same position
-- wherever their rows were missing.
--
-- Adds the three Gulf currencies. Existing rows are left untouched, so if
-- SAR or QAR were already maintained by hand, their rates do not change.
--
-- Rates are the official USD pegs, which have been fixed for decades:
--   AED 3.6725 / USD  →  1 AED = 1          AED  (base)
--   SAR 3.75   / USD  →  1 SAR = 3.6725/3.75 = 0.979333 AED
--   QAR 3.64   / USD  →  1 QAR = 3.6725/3.64 = 1.008929 AED
--
-- The AED row exists only to satisfy the foreign key. fetchRates() still
-- forces AED to exactly 1 after reading, so editing this row cannot move it.

INSERT INTO exchange_rates (currency, rate_to_aed, updated_at)
SELECT v.currency, v.rate, now()
FROM (VALUES ('AED', 1.000000),
             ('SAR', 0.979333),
             ('QAR', 1.008929)) AS v(currency, rate)
WHERE NOT EXISTS (SELECT 1 FROM exchange_rates e WHERE e.currency = v.currency);

-- Verify — all three should be listed:
--   SELECT currency, rate_to_aed FROM exchange_rates
--   WHERE currency IN ('AED','SAR','QAR') ORDER BY currency;
--
-- And to see every currency foreign key on pricing_master:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint WHERE conrelid = 'pricing_master'::regclass AND contype = 'f';
