-- Tabela bosses
CREATE TABLE IF NOT EXISTS bosses (
  id BIGSERIAL PRIMARY KEY,
  boss_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'ATIVO' CHECK (status IN ('ATIVO', 'INATIVO')),
  max_health NUMERIC NOT NULL,
  current_health NUMERIC NOT NULL,
  damage_per_buy NUMERIC NOT NULL,
  heal_per_sell NUMERIC NOT NULL,
  buy_weight NUMERIC NOT NULL,
  sell_weight NUMERIC NOT NULL,
  damage_multiplier NUMERIC,
  heal_multiplier NUMERIC,
  sprites JSONB NOT NULL DEFAULT '{"idle":"","hitting":"","healing":"","dead":""}',
  is_defeated BOOLEAN NOT NULL DEFAULT FALSE,
  defeated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bosses_boss_id ON bosses(boss_id);
CREATE INDEX IF NOT EXISTS idx_bosses_is_defeated ON bosses(is_defeated);

-- Tabela trades
CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  boss_id BIGINT NOT NULL REFERENCES bosses(id) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  mint TEXT NOT NULL,
  sol_amount NUMERIC NOT NULL,
  token_amount NUMERIC NOT NULL,
  tx_type TEXT NOT NULL CHECK (tx_type IN ('buy', 'sell')),
  damage_dealt NUMERIC,
  heal_applied NUMERIC,
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_signature ON trades(signature);
CREATE INDEX IF NOT EXISTS idx_trades_boss_id ON trades(boss_id);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);

-- Tabela game_session (singleton - sempre 1 linha)
CREATE TABLE IF NOT EXISTS game_session (
  id BIGSERIAL PRIMARY KEY,
  current_boss_id BIGINT REFERENCES bosses(id) ON DELETE SET NULL,
  total_damage_dealt NUMERIC NOT NULL DEFAULT 0,
  total_heal_applied NUMERIC NOT NULL DEFAULT 0,
  session_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A primeira sessão é criada pela aplicação em getOrCreateGameSession
