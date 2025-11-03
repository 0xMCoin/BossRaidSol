import fs from "fs";
import path from "path";

// Define interfaces for data storage
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
  createdAt: string;
  updatedAt: string;
}

// Simplified boss data format for registration
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

interface GameData {
  bosses: Boss[];
  trades: PumpPortalTrade[];
  gameSession: GameSession;
}

// File-based storage paths
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "game-data.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
// Load data from file
function loadData(): GameData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(data);
      return parsed;
    } else {
    }
  } catch (error) {
    console.error("❌ DB: Error loading game data:", error);
  }

  return {
    bosses: [],
    trades: [],
    gameSession: {
      id: 1,
      currentBossId: 1,
      totalDamageDealt: 0,
      totalHealApplied: 0,
      sessionStart: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    },
  };
}

// Save data to file
function saveData(data: GameData): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Error saving game data:", error);
  }
}

// Boss operations
export function getAllBosses(): Boss[] {
  const data = loadData();
  return data.bosses;
}

export function getBossById(id: number): Boss | null {
  const data = loadData();
  return data.bosses.find((boss) => boss.id === id) || null;
}

export function getBossByBossId(bossId: string): Boss | null {
  const data = loadData();
  return data.bosses.find((boss) => boss.bossId === bossId) || null;
}

export function addOrUpdateBoss(
  bossData: Omit<Boss, "id" | "createdAt" | "updatedAt">
): Boss {
  const data = loadData();
  const now = new Date().toISOString();

  // Find existing boss by bossId
  const existingIndex = data.bosses.findIndex(
    (boss) => boss.bossId === bossData.bossId
  );

  if (existingIndex !== -1) {
    // Update existing boss
    const existingBoss = data.bosses[existingIndex];
    data.bosses[existingIndex] = {
      ...existingBoss,
      ...bossData,
      updatedAt: now,
    };
    saveData(data);
    return data.bosses[existingIndex];
  } else {
    // Add new boss
    const newId = Math.max(...data.bosses.map((b) => b.id), 0) + 1;
    const newBoss: Boss = {
      ...bossData,
      id: newId,
      createdAt: now,
      updatedAt: now,
    };
    data.bosses.push(newBoss);
    saveData(data);
    return newBoss;
  }
}

export function registerBossFromData(bossRegData: BossRegistrationData): Boss {
  const bossData: Omit<Boss, "id" | "createdAt" | "updatedAt"> = {
    bossId: bossRegData.id,
    name: bossRegData.name,
    maxHealth: bossRegData.hpMax,
    currentHealth: bossRegData.hpMax, // Start with full health
    damagePerBuy: bossRegData.buyDmg,
    healPerSell: bossRegData.sellHeal,
    buyWeight: bossRegData.buyWeight,
    sellWeight: bossRegData.sellWeight,
    sprites: bossRegData.sprites,
    isDefeated: false,
  };

  return addOrUpdateBoss(bossData);
}

export function updateBossHealth(
  id: number,
  currentHealth: number,
  isDefeated: boolean = false
) {
  const data = loadData();
  const bossIndex = data.bosses.findIndex((boss) => boss.id === id);

  if (bossIndex === -1) {
    throw new Error(`Boss with id ${id} not found`);
  }

  const boss = data.bosses[bossIndex];
  const oldHealth = boss.currentHealth;

  // Security: Validate health change logic
  if (currentHealth < 0 || currentHealth > boss.maxHealth) {
    throw new Error(
      `Invalid health value: ${currentHealth}. Must be between 0 and ${boss.maxHealth}`
    );
  }

  // Security: Only allow health reduction (damage) or healing to valid amounts
  if (currentHealth > oldHealth && currentHealth > boss.maxHealth) {
    throw new Error(
      `Invalid health increase: ${currentHealth} > ${boss.maxHealth}`
    );
  }

  // Audit: Log health changes (only in production logs, not console)
  // This helps track all boss health modifications
  const auditLog = {
    timestamp: new Date().toISOString(),
    bossId: id,
    bossName: boss.name,
    oldHealth,
    newHealth: currentHealth,
    isDefeated,
    change: currentHealth - oldHealth,
  };

  // In production, you might want to save this to a separate audit log file
  console.log(`AUDIT: Boss health change:`, JSON.stringify(auditLog));

  // Update boss health
  data.bosses[bossIndex].currentHealth = currentHealth;
  data.bosses[bossIndex].isDefeated = isDefeated;

  // If boss is defeated, mark defeated time
  if (isDefeated && !data.bosses[bossIndex].defeatedAt) {
    data.bosses[bossIndex].defeatedAt = new Date().toISOString();
  }

  saveData(data);
}

export function getCurrentBoss(): Boss | null {
  const data = loadData();
  const currentBoss = data.bosses.find((boss) => !boss.isDefeated) || null;
  return currentBoss;
}

// Trade operations
export function saveTrade(trade: Omit<PumpPortalTrade, "id" | "createdAt">) {
  const data = loadData();

  // Check if trade already exists (prevent duplicates)
  const existingTrade = data.trades.find(
    (t) => t.signature === trade.signature
  );
  if (existingTrade) {
    return; // Skip duplicate
  }

  const newTrade: PumpPortalTrade = {
    ...trade,
    id: Date.now(), // Simple ID generation
    createdAt: new Date().toISOString(),
  };

  data.trades.push(newTrade);

  // Keep only last 1000 trades to prevent file from growing too large
  if (data.trades.length > 1000) {
    data.trades = data.trades.slice(-1000);
  }

  saveData(data);
}

export function getTradesForBoss(
  bossId: number,
  limit: number = 50
): PumpPortalTrade[] {
  const data = loadData();
  return data.trades
    .filter((trade) => trade.bossId === bossId)
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    .slice(0, limit);
}

// Game session operations
export function getOrCreateGameSession(): GameSession {
  const data = loadData();
  return data.gameSession;
}

export function updateGameSession(
  sessionId: number,
  damageDealt: number = 0,
  healApplied: number = 0,
  newBossId?: number
) {
  const data = loadData();

  if (data.gameSession.id === sessionId) {
    data.gameSession.totalDamageDealt += damageDealt;
    data.gameSession.totalHealApplied += healApplied;
    if (newBossId) {
      data.gameSession.currentBossId = newBossId;
    }
    data.gameSession.lastActivity = new Date().toISOString();
    saveData(data);
  }
}

// Statistics
export function getGameStats() {
  const data = loadData();

  const buyTrades = data.trades.filter((t) => t.txType === "buy");
  const sellTrades = data.trades.filter((t) => t.txType === "sell");

  return {
    totalBuyTrades: buyTrades.length,
    totalSellTrades: sellTrades.length,
    totalSolFromBuys: buyTrades.reduce((sum, t) => sum + t.solAmount, 0),
    totalSolFromSells: sellTrades.reduce((sum, t) => sum + t.solAmount, 0),
    totalDamageDealt: data.trades.reduce(
      (sum, t) => sum + (t.damageDealt || 0),
      0
    ),
    totalHealApplied: data.trades.reduce(
      (sum, t) => sum + (t.healApplied || 0),
      0
    ),
    bossesDefeated: data.bosses.filter((b) => b.isDefeated).length,
  };
}

export function resetGame() {
  const data = loadData();
  saveData(data);
}
