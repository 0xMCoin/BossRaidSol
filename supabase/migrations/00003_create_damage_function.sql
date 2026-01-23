-- Função SQL para calcular top damage dealers de forma eficiente
-- Isso é MUITO mais rápido que buscar na blockchain

CREATE OR REPLACE FUNCTION get_top_damage_dealers(
  p_boss_id BIGINT,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  address TEXT,
  total_damage NUMERIC,
  total_heal NUMERIC,
  net_damage NUMERIC,
  buy_count BIGINT,
  sell_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.trader_address AS address,
    COALESCE(SUM(t.damage_dealt), 0) AS total_damage,
    COALESCE(SUM(t.heal_applied), 0) AS total_heal,
    COALESCE(SUM(t.damage_dealt), 0) - COALESCE(SUM(t.heal_applied), 0) AS net_damage,
    COUNT(*) FILTER (WHERE t.tx_type = 'buy') AS buy_count,
    COUNT(*) FILTER (WHERE t.tx_type = 'sell') AS sell_count
  FROM trades t
  WHERE t.boss_id = p_boss_id
    AND t.trader_address IS NOT NULL
  GROUP BY t.trader_address
  HAVING (COALESCE(SUM(t.damage_dealt), 0) - COALESCE(SUM(t.heal_applied), 0)) > 0
  ORDER BY net_damage DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
