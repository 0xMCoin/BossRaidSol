#!/usr/bin/env tsx
/**
 * Migra dados de data/game-data.json para o Supabase.
 * Uso: npx tsx scripts/migrate-json-to-supabase.ts
 * Requer: .env.local com NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
 *
 * Ordem: 1) Aplicar migração SQL no Supabase (supabase/migrations/00001_initial_schema.sql)
 *        2) Executar este script
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local");
  process.exit(1);
}

const supabase = createClient(url, key);

const DATA_FILE = path.join(process.cwd(), "data", "game-data.json");

interface JsonBoss {
  id: number;
  bossId: string;
  name: string;
  status?: string;
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
  createdAt: string;
  updatedAt: string;
}

interface JsonTrade {
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
}

interface JsonGameSession {
  id: number;
  currentBossId: number;
  totalDamageDealt: number;
  totalHealApplied: number;
  sessionStart: string;
  lastActivity: string;
}

interface GameData {
  bosses: JsonBoss[];
  trades: JsonTrade[];
  gameSession: JsonGameSession;
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error("Arquivo não encontrado:", DATA_FILE);
    process.exit(1);
  }

  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  const data: GameData = JSON.parse(raw);

  console.log("Migrando:", data.bosses.length, "bosses,", data.trades.length, "trades, 1 game_session");

  // 1) Limpar tabelas (ordem por causa de FK)
  const { error: e1 } = await supabase.from("trades").delete().gte("id", 0);
  if (e1) console.warn("Aviso ao limpar trades (pode estar vazia):", e1.message);

  const { error: e2 } = await supabase.from("game_session").delete().gte("id", 0);
  if (e2) console.warn("Aviso ao limpar game_session:", e2.message);

  const { error: e3 } = await supabase.from("bosses").delete().gte("id", 0);
  if (e3) {
    console.error("Erro ao limpar bosses:", e3);
    process.exit(1);
  }

  // 2) Inserir bosses (em ordem de id para preservar IDs para as FKs em trades)
  const sortedBosses = [...data.bosses].sort((a, b) => a.id - b.id);
  for (const b of sortedBosses) {
    const { error } = await supabase.from("bosses").insert({
      id: b.id,
      boss_id: b.bossId,
      name: b.name,
      status: b.status || "ATIVO",
      max_health: b.maxHealth,
      current_health: b.currentHealth,
      damage_per_buy: b.damagePerBuy,
      heal_per_sell: b.healPerSell,
      buy_weight: b.buyWeight,
      sell_weight: b.sellWeight,
      damage_multiplier: b.damageMultiplier ?? null,
      heal_multiplier: b.healMultiplier ?? null,
      sprites: b.sprites,
      is_defeated: b.isDefeated ?? false,
      defeated_at: b.defeatedAt || null,
      created_at: b.createdAt,
      updated_at: b.updatedAt,
    });
    if (error) {
      console.error("Erro ao inserir boss", b.bossId, error);
      process.exit(1);
    }
  }
  console.log("Bosses inseridos.");

  // Se for inserir novos bosses depois (ex: register-bosses), rode no SQL Editor do Supabase:
  // SELECT setval('bosses_id_seq', (SELECT COALESCE(MAX(id),1) FROM bosses));

  // 3) Inserir game_session
  const gs = data.gameSession;
  const { error: eg } = await supabase.from("game_session").insert({
    id: gs.id,
    current_boss_id: gs.currentBossId,
    total_damage_dealt: gs.totalDamageDealt,
    total_heal_applied: gs.totalHealApplied,
    session_start: gs.sessionStart,
    last_activity: gs.lastActivity,
  });
  if (eg) {
    console.error("Erro ao inserir game_session:", eg);
    process.exit(1);
  }
  console.log("game_session inserido.");

  // 4) Inserir trades em lotes (evitar payload muito grande)
  const BATCH = 200;
  for (let i = 0; i < data.trades.length; i += BATCH) {
    const batch = data.trades.slice(i, i + BATCH).map((t) => ({
      boss_id: t.bossId,
      signature: t.signature,
      mint: t.mint,
      sol_amount: t.solAmount,
      token_amount: t.tokenAmount,
      tx_type: t.txType,
      damage_dealt: t.damageDealt ?? null,
      heal_applied: t.healApplied ?? null,
      timestamp: t.timestamp,
      created_at: t.createdAt,
    }));
    const { error } = await supabase.from("trades").insert(batch);
    if (error) {
      console.error("Erro ao inserir trades (lote", i / BATCH + 1, "):", error);
      process.exit(1);
    }
  }
  console.log("Trades inseridos.");

  console.log("Migração concluída.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
