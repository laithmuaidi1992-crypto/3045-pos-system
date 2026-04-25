-- ─────────────────────────────────────────────────────────────────────────────
--  Migration: Add bank terminal reference fields to transactions
--  Date: 2026-04-25
--  Project: 3045 Super Market POS · Arab Bank Jordan integration
--
--  Adds the fields needed to capture and audit card payments processed via
--  the WizarPOS Q2 (or any external bank terminal):
--    • bank_rrn         — Retrieval Reference Number (12 digits, unique per txn)
--    • bank_approval    — Authorization / Approval code from issuing bank
--    • bank_last4       — Last 4 digits of card PAN (PCI-safe)
--    • bank_brand       — Card scheme (Visa, MasterCard, JoMoPay, ...)
--    • bank_terminal_id — Physical terminal ID that processed the txn
--    • bank_response    — Full JSON response from terminal (for audit/dispute)
--
--  All fields are nullable — existing cash/CliQ/credit transactions remain valid.
--  Run in Supabase SQL editor or via psql.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS bank_rrn         text,
  ADD COLUMN IF NOT EXISTS bank_approval    text,
  ADD COLUMN IF NOT EXISTS bank_last4       text,
  ADD COLUMN IF NOT EXISTS bank_brand       text,
  ADD COLUMN IF NOT EXISTS bank_terminal_id text,
  ADD COLUMN IF NOT EXISTS bank_response    jsonb;

-- Index for daily settlement matching against bank's report
CREATE INDEX IF NOT EXISTS idx_tx_bank_rrn ON transactions (bank_rrn) WHERE bank_rrn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_bank_terminal ON transactions (bank_terminal_id, created_at) WHERE bank_terminal_id IS NOT NULL;

-- Constraint: when a card payment is recorded with bank reference, RRN must
-- be unique (prevents accidental double-recording of the same physical txn)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_tx_bank_rrn_per_terminal'
  ) THEN
    -- Allow nulls (cash txns); enforce uniqueness only when both fields populated
    CREATE UNIQUE INDEX uq_tx_bank_rrn_per_terminal
      ON transactions (bank_terminal_id, bank_rrn)
      WHERE bank_rrn IS NOT NULL AND bank_terminal_id IS NOT NULL;
  END IF;
END $$;

-- Optional: settlement reconciliation table to import the bank's daily report
CREATE TABLE IF NOT EXISTS bank_settlement (
  id              bigserial PRIMARY KEY,
  settlement_date date NOT NULL,
  terminal_id     text,
  rrn             text NOT NULL,
  approval        text,
  amount          numeric(12,3) NOT NULL,
  card_brand      text,
  last4           text,
  imported_at     timestamptz NOT NULL DEFAULT now(),
  matched_tx_id   text REFERENCES transactions(id),
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_settlement_date ON bank_settlement (settlement_date);
CREATE INDEX IF NOT EXISTS idx_settlement_rrn ON bank_settlement (rrn);

-- Verification query (run after migration):
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name='transactions' AND column_name LIKE 'bank_%';
