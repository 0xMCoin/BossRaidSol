-- Migration: Add trader_address to trades table for performance
-- This allows us to calculate damage rankings without querying blockchain

ALTER TABLE trades 
ADD COLUMN IF NOT EXISTS trader_address TEXT;

CREATE INDEX IF NOT EXISTS idx_trades_trader_address ON trades(trader_address);
CREATE INDEX IF NOT EXISTS idx_trades_boss_trader ON trades(boss_id, trader_address);

-- Update existing trades in background (optional, can be done later)
-- This will be populated gradually as new trades come in
