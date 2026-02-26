import { supabase } from "@/lib/supabase/server";

// Define interfaces for data storage (camelCase para compatibilidade com o resto da app)
export interface Boss {
  id: number;
  bossId: string;
  name: string;
  status?: "ATIVO" | "INATIVO";
  maxHealth: number;
  currentHealth: number;
  damagePerBuy: number;
  healPerSell: number;
  buyWeight: number;
  sellWeight: number;
  damageMultiplier?: number;
  healMultiplier?: number;
  sprites: { idle: string; hitting: string; healing: string; dead: string };
  isDefeated: boolean;
  defeatedAt?: string;
  twitter?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BossRegistrationData {
  id: string;
  name: string;
  hpMax: number;
  buyWeight: number;
  sellWeight: number;
  buyDmg: number;
  sellHeal: number;
  sprites: {
    idle: string;
    hitting: string;
    healing: string;
    dead: string;
  };
  twitter?: string;
}

export interface PumpPortalTrade {
  id: number;
  bossId: number;
  signature: string;
  mint: string;
  solAmount: number;
  tokenAmount: number;
  txType: "buy" | "sell";
  damageDealt?: number;
  healApplied?: number;
  timestamp: string;
  createdAt: string;
  traderAddress?: string;
}

export interface PumpPortalToken {
  signature: string;
  mint: string;
  traderPublicKey: string;
  txType: "create" | "sell" | "buy";
  initialBuy?: number;
  solAmount: number;
  tokenAmount: number;
  marketCapSol: number;
  name: string;
  symbol: string;
  uri: string;
  timestamp: number;
  vTokensInBondingCurve: number;
  vSolInBondingCurve: number;
  marketCap: number;
}

export interface GameSession {
  id: number;
  currentBossId: number;
  totalDamageDealt: number;
  totalHealApplied: number;
  sessionStart: string;
  lastActivity: string;
}

// Mapear linha do Supabase (snake_case) para Boss (camelCase)
function mapRowToBoss(row: Record<string, unknown>): Boss {
  return {
    id: Number(row.id),
    bossId: String(row.boss_id),
    name: String(row.name),
    status: row.status as "ATIVO" | "INATIVO" | undefined,
    maxHealth: Number(row.max_health),
    currentHealth: Number(row.current_health),
    damagePerBuy: Number(row.damage_per_buy),
    healPerSell: Number(row.heal_per_sell),
    buyWeight: Number(row.buy_weight),
    sellWeight: Number(row.sell_weight),
    damageMultiplier: row.damage_multiplier != null ? Number(row.damage_multiplier) : undefined,
    healMultiplier: row.heal_multiplier != null ? Number(row.heal_multiplier) : undefined,
    sprites: (() => {
      const s = row.sprites as { idle?: string; hitting?: string; healing?: string; dead?: string } | null | undefined;
      return {
        idle: s?.idle ?? "",
        hitting: s?.hitting ?? "",
        healing: s?.healing ?? "",
        dead: s?.dead ?? "",
      };
    })(),
    isDefeated: Boolean(row.is_defeated),
    defeatedAt: row.defeated_at != null ? String(row.defeated_at) : undefined,
    twitter: row.twitter != null ? String(row.twitter) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRowToTrade(row: Record<string, unknown>): PumpPortalTrade {
  return {
    id: Number(row.id),
    bossId: Number(row.boss_id),
    signature: String(row.signature),
    mint: String(row.mint),
    solAmount: Number(row.sol_amount),
    tokenAmount: Number(row.token_amount),
    txType: row.tx_type as "buy" | "sell",
    damageDealt: row.damage_dealt != null ? Number(row.damage_dealt) : undefined,
    healApplied: row.heal_applied != null ? Number(row.heal_applied) : undefined,
    timestamp: String(row.timestamp),
    createdAt: String(row.created_at),
  };
}

function mapRowToGameSession(row: Record<string, unknown>): GameSession {
  const firstBossId = row.current_boss_id != null ? Number(row.current_boss_id) : 1;
  return {
    id: Number(row.id),
    currentBossId: firstBossId,
    totalDamageDealt: Number(row.total_damage_dealt ?? 0),
    totalHealApplied: Number(row.total_heal_applied ?? 0),
    sessionStart: String(row.session_start),
    lastActivity: String(row.last_activity),
  };
}

// --- Boss operations ---

export async function getAllBosses(): Promise<Boss[]> {
  const { data, error } = await supabase
    .from("bosses")
    .select("*")
    .order("id", { ascending: true });

  if (error) {
    console.error("getAllBosses error:", error);
    return [];
  }
  return (data || []).map(mapRowToBoss);
}

export async function getBossById(id: number): Promise<Boss | null> {
  const { data, error } = await supabase
    .from("bosses")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return mapRowToBoss(data);
}

export async function getBossByBossId(bossId: string): Promise<Boss | null> {
  const { data, error } = await supabase
    .from("bosses")
    .select("*")
    .eq("boss_id", bossId)
    .single();

  if (error || !data) return null;
  return mapRowToBoss(data);
}

export async function addOrUpdateBoss(
  bossData: Omit<Boss, "id" | "createdAt" | "updatedAt">
): Promise<Boss> {
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("bosses")
    .select("id")
    .eq("boss_id", bossData.bossId)
    .single();

  const row = {
    boss_id: bossData.bossId,
    name: bossData.name,
    status: bossData.status ?? "ATIVO",
    max_health: bossData.maxHealth,
    current_health: bossData.currentHealth,
    damage_per_buy: bossData.damagePerBuy,
    heal_per_sell: bossData.healPerSell,
    buy_weight: bossData.buyWeight,
    sell_weight: bossData.sellWeight,
    damage_multiplier: bossData.damageMultiplier ?? null,
    heal_multiplier: bossData.healMultiplier ?? null,
    sprites: bossData.sprites,
    is_defeated: bossData.isDefeated ?? false,
    defeated_at: bossData.defeatedAt ?? null,
    twitter: bossData.twitter ?? null,
    updated_at: now,
  };

  if (existing) {
    const { data, error } = await supabase
      .from("bosses")
      .update(row)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw new Error(`addOrUpdateBoss update: ${error.message}`);
    return mapRowToBoss(data!);
  }

  const { data, error } = await supabase
    .from("bosses")
    .insert({ ...row, created_at: now })
    .select()
    .single();

  if (error) throw new Error(`addOrUpdateBoss insert: ${error.message}`);
  return mapRowToBoss(data!);
}

export function registerBossFromData(bossRegData: BossRegistrationData): Promise<Boss> {
  const bossData: Omit<Boss, "id" | "createdAt" | "updatedAt"> = {
    bossId: bossRegData.id,
    name: bossRegData.name,
    maxHealth: bossRegData.hpMax,
    currentHealth: bossRegData.hpMax,
    damagePerBuy: bossRegData.buyDmg,
    healPerSell: bossRegData.sellHeal,
    buyWeight: bossRegData.buyWeight,
    sellWeight: bossRegData.sellWeight,
    sprites: bossRegData.sprites,
    isDefeated: false,
    twitter: bossRegData.twitter,
  };
  return addOrUpdateBoss(bossData);
}

export async function updateBossHealth(
  id: number,
  currentHealth: number,
  isDefeated: boolean = false
): Promise<void> {
  const boss = await getBossById(id);
  if (!boss) throw new Error(`Boss with id ${id} not found`);

  // Se o boss já está derrotado, não permitir curar (a menos que seja um reset explícito)
  if (boss.isDefeated && currentHealth > boss.currentHealth && !isDefeated) {
    throw new Error(`Boss ${boss.name} já está derrotado e não pode ser curado`);
  }

  if (currentHealth < 0 || currentHealth > boss.maxHealth) {
    throw new Error(
      `Invalid health value: ${currentHealth}. Must be between 0 and ${boss.maxHealth}`
    );
  }

  // Se a vida chegou a 0 ou menos, marcar como derrotado
  const shouldBeDefeated = currentHealth <= 0 || isDefeated;

  const updates: Record<string, unknown> = {
    current_health: Math.max(0, currentHealth), // Garantir que nunca seja negativo
    is_defeated: shouldBeDefeated,
    updated_at: new Date().toISOString(),
  };
  if (shouldBeDefeated && !boss.isDefeated) {
    updates.defeated_at = new Date().toISOString();
  }

  const { error } = await supabase.from("bosses").update(updates).eq("id", id);
  if (error) throw new Error(`updateBossHealth: ${error.message}`);
}

export async function getCurrentBoss(): Promise<Boss | null> {
  const { data, error } = await supabase
    .from("bosses")
    .select("*")
    .eq("is_defeated", false)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return mapRowToBoss(data);
}

// --- Trade operations ---

export async function saveTrade(trade: Omit<PumpPortalTrade, "id" | "createdAt">): Promise<void> {
  const { data: existing } = await supabase
    .from("trades")
    .select("id, trader_address")
    .eq("signature", trade.signature)
    .maybeSingle();

  if (existing) {
    // Se já existe mas não tem trader_address, atualizar em background
    if (!existing.trader_address && trade.traderAddress) {
      // Atualizar em background sem bloquear
      (async () => {
        try {
          await supabase
            .from("trades")
            .update({ trader_address: trade.traderAddress })
            .eq("signature", trade.signature);
        } catch {
          // Ignorar erros em background
        }
      })();
    }
    return;
  }

  const { error } = await supabase.from("trades").insert({
    boss_id: trade.bossId,
    signature: trade.signature,
    mint: trade.mint,
    sol_amount: trade.solAmount,
    token_amount: trade.tokenAmount,
    tx_type: trade.txType,
    damage_dealt: trade.damageDealt ?? null,
    heal_applied: trade.healApplied ?? null,
    timestamp: trade.timestamp,
    trader_address: trade.traderAddress ?? null,
  });

  // Ignorar erro de duplicate key (pode acontecer em race conditions)
  if (error) {
    // Código 23505 é "unique_violation" no PostgreSQL
    if (error.code === "23505" || error.message.includes("duplicate key") || error.message.includes("unique constraint")) {
      console.log(`Trade ${trade.signature} already exists, skipping...`);
      return;
    }
    throw new Error(`saveTrade: ${error.message}`);
  }

  // Se não tinha trader_address, buscar em background (não bloqueia)
  if (!trade.traderAddress) {
    fetchTraderAddressInBackground(trade.signature).catch(() => {});
  }
}

// Função para buscar trader address em background (não bloqueia a resposta)
async function fetchTraderAddressInBackground(signature: string): Promise<void> {
  try {
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    const { Connection } = await import("@solana/web3.js");
    const connection = new Connection(rpcUrl, "confirmed");

    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (tx && tx.transaction.message.staticAccountKeys.length > 0) {
      const traderAddress = tx.transaction.message.staticAccountKeys[0].toBase58();
      
      const { error } = await supabase
        .from("trades")
        .update({ trader_address: traderAddress })
        .eq("signature", signature);
      
      if (error) {
        console.log(`Error updating trader_address for ${signature}:`, error);
      } else {
        console.log(`Updated trader_address for ${signature}: ${traderAddress}`);
      }
    }
  } catch (error) {
    // Log mas não falha - não é crítico
    console.log(`Could not fetch trader address for ${signature}:`, error);
  }
}

export async function getTradesForBoss(
  bossId: number,
  limit: number = 50
): Promise<PumpPortalTrade[]> {
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .eq("boss_id", bossId)
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data || []).map(mapRowToTrade);
}

export interface TopDamageDealer {
  address: string;
  totalDamage: number;
  totalHeal: number;
  netDamage: number; // damage - heal
  buyCount: number;
  sellCount: number;
}

export async function getTopDamageDealers(
  bossId: number,
  limit: number = 50
): Promise<TopDamageDealer[]> {
  // Buscar todas as trades do boss
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .eq("boss_id", bossId)
    .order("timestamp", { ascending: false });

  if (error || !data) return [];

  // Agrupar por signature primeiro (para depois buscar o trader)
  const tradesBySignature = new Map<string, {
    damageDealt: number;
    healApplied: number;
    buyCount: number;
    sellCount: number;
  }>();

  for (const trade of data) {
    const sig = String(trade.signature);
    const damage = trade.damage_dealt ? Number(trade.damage_dealt) : 0;
    const heal = trade.heal_applied ? Number(trade.heal_applied) : 0;
    const txType = String(trade.tx_type);

    const existing = tradesBySignature.get(sig) || {
      damageDealt: 0,
      healApplied: 0,
      buyCount: 0,
      sellCount: 0,
    };

    existing.damageDealt += damage;
    existing.healApplied += heal;
    if (txType === "buy") existing.buyCount++;
    if (txType === "sell") existing.sellCount++;

    tradesBySignature.set(sig, existing);
  }

  // Retornar agrupado por signature (será resolvido na API usando RPC)
  // Por enquanto, retornamos vazio e a API vai buscar os signers
  return [];
}

// --- Game session operations ---

export async function getOrCreateGameSession(): Promise<GameSession> {
  const { data: existing } = await supabase
    .from("game_session")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (existing) return mapRowToGameSession(existing);

  // Buscar o primeiro boss para current_boss_id
  const { data: firstBoss } = await supabase
    .from("bosses")
    .select("id")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  const now = new Date().toISOString();
  const { data: inserted, error } = await supabase
    .from("game_session")
    .insert({
      current_boss_id: firstBoss?.id ?? null,
      total_damage_dealt: 0,
      total_heal_applied: 0,
      session_start: now,
      last_activity: now,
    })
    .select()
    .single();

  if (error) throw new Error(`getOrCreateGameSession: ${error.message}`);
  return mapRowToGameSession(inserted!);
}

export async function updateGameSession(
  sessionId: number,
  damageDealt: number = 0,
  healApplied: number = 0,
  newBossId?: number
): Promise<void> {
  const { data: session } = await supabase
    .from("game_session")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (!session) return;

  const updates: Record<string, unknown> = {
    total_damage_dealt: Number(session.total_damage_dealt ?? 0) + damageDealt,
    total_heal_applied: Number(session.total_heal_applied ?? 0) + healApplied,
    last_activity: new Date().toISOString(),
  };
  if (newBossId != null) updates.current_boss_id = newBossId;

  await supabase.from("game_session").update(updates).eq("id", sessionId);
}

export async function getGameStats(): Promise<{
  totalBuyTrades: number;
  totalSellTrades: number;
  totalSolFromBuys: number;
  totalSolFromSells: number;
  totalDamageDealt: number;
  totalHealApplied: number;
  bossesDefeated: number;
}> {
  const [tradesRes, bossesRes] = await Promise.all([
    supabase.from("trades").select("tx_type, sol_amount, damage_dealt, heal_applied"),
    supabase.from("bosses").select("is_defeated"),
  ]);

  const trades = tradesRes.data || [];
  const bosses = bossesRes.data || [];

  const buyTrades = trades.filter((t) => t.tx_type === "buy");
  const sellTrades = trades.filter((t) => t.tx_type === "sell");

  return {
    totalBuyTrades: buyTrades.length,
    totalSellTrades: sellTrades.length,
    totalSolFromBuys: buyTrades.reduce((s, t) => s + Number(t.sol_amount ?? 0), 0),
    totalSolFromSells: sellTrades.reduce((s, t) => s + Number(t.sol_amount ?? 0), 0),
    totalDamageDealt: trades.reduce((s, t) => s + Number(t.damage_dealt ?? 0), 0),
    totalHealApplied: trades.reduce((s, t) => s + Number(t.heal_applied ?? 0), 0),
    bossesDefeated: bosses.filter((b) => b.is_defeated).length,
  };
}

export async function resetGame(): Promise<void> {
  const now = new Date().toISOString();

  // Resetar current_health = max_health, is_defeated = false em todos os bosses
  const { data: bosses } = await supabase.from("bosses").select("id, max_health");
  if (bosses?.length) {
    for (const b of bosses) {
      await supabase
        .from("bosses")
        .update({
          current_health: b.max_health,
          is_defeated: false,
          defeated_at: null,
          updated_at: now,
        })
        .eq("id", b.id);
    }
  }

  // Resetar game_session
  const { data: session } = await supabase
    .from("game_session")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (session) {
    const { data: first } = await supabase
      .from("bosses")
      .select("id")
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    await supabase
      .from("game_session")
      .update({
        current_boss_id: first?.id ?? null,
        total_damage_dealt: 0,
        total_heal_applied: 0,
        last_activity: now,
      })
      .eq("id", session.id);
  }
}
