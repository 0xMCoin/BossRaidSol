"use client";
import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import type { Boss as DatabaseBoss } from "@/lib/db/database";

// Security: Trade rate limiting
let tradeTimestamps: number[] = [];
const RATE_LIMIT = 10; // 10 trades por segundo máximo
const RATE_WINDOW = 1000; // 1 segundo

// Security: Validate trade data
const isValidTradeData = (data: any): boolean => {
  return (
    data.signature &&
    data.mint &&
    typeof data.solAmount === 'number' &&
    data.solAmount > 0 &&
    data.solAmount < 1000 && // Limite máximo de 1000 SOL por trade
    ['buy', 'sell'].includes(data.txType?.toLowerCase()) &&
    data.mint === "FbAKcBJCeZgJskA2qdhtZumrtnC1R43W3JVWKthnpump" // Apenas token específico
  );
};

// Security: Check rate limit
const isRateLimited = (): boolean => {
  const now = Date.now();
  tradeTimestamps.push(now);

  // Remove trades antigos (último segundo)
  while (tradeTimestamps.length > 0 && tradeTimestamps[0] < now - RATE_WINDOW) {
    tradeTimestamps.shift();
  }

  return tradeTimestamps.length > RATE_LIMIT;
};

// Security: API Configuration
const API_KEY = process.env.NEXT_PUBLIC_BOSS_RAID_API_KEY || 'dev-key-change-in-production';

// Security: WebSocket reconnection with limits
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1000; // 1 second

// Security: Validate boss state before processing trades
const isValidBossState = (boss: any): boolean => {
  return (
    boss &&
    boss.id &&
    boss.name &&
    typeof boss.currentHealth === 'number' &&
    typeof boss.maxHealth === 'number' &&
    boss.currentHealth >= 0 &&
    boss.maxHealth > 0 &&
    boss.currentHealth <= boss.maxHealth &&
    !boss.isDefeated &&
    boss.damageMultiplier >= 0 &&
    boss.healMultiplier >= 0
  );
};

type BossState = "idle" | "hitting" | "healing" | "dead";

export default function Home() {
  const [bossState, setBossState] = useState<BossState>("idle");

  // Security: Safe WebSocket reconnection with exponential backoff
  const safeReconnect = () => {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = BASE_RECONNECT_DELAY * reconnectAttempts; // Exponential backoff
      setTimeout(() => {
        connectWebSocket();
      }, delay);
    }
  };
  const [currentBoss, setCurrentBoss] = useState<DatabaseBoss | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [damageText, setDamageText] = useState<string>("");
  const [healText, setHealText] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);

  const [trades, setTrades] = useState<any[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastTradeActivity, setLastTradeActivity] = useState<string>("");
  const [gameSession, setGameSession] = useState<any>(null);

  const loadGameData = async () => {
    try {
      const bossResponse = await fetch("/api/bosses?action=current");
      const bossData = await bossResponse.json();
      if (bossData.boss) {
        setCurrentBoss(bossData.boss);
      }
      const sessionResponse = await fetch("/api/game?action=session");
      const sessionData = await sessionResponse.json();
      if (sessionData.session) {
        setGameSession(sessionData.session);
      }
    } catch (error) {}
  };

  const saveTradeToDatabase = async (tradeData: any) => {
    try {
      await fetch("/api/trades", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tradeData),
      });
    } catch (error) {
      console.error("Error saving trade:", error);
    }
  };

  const updateBossInDatabase = async (
    bossId: number,
    health: number,
    isDefeated: boolean = false,
    tradeSignature?: string
  ) => {
    try {
      const response = await fetch("/api/bosses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
        body: JSON.stringify({
          action: "updateHealth",
          bossId,
          currentHealth: health,
          isDefeated,
          signature: tradeSignature, // Required for security validation
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Boss update failed:", errorData.error);
        return;
      }

      // Log successful updates for audit trail
      console.log(`Boss ${bossId} health updated to ${health}`);
    } catch (error) {
      console.error("Error updating boss:", error);
    }
  };

  const updateGameSession = async (
    damageDealt: number = 0,
    healApplied: number = 0,
    newBossId?: number
  ) => {
    if (!gameSession) return;

    try {
      await fetch("/api/game", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "updateSession",
          sessionId: gameSession.id,
          damageDealt,
          healApplied,
          newBossId,
        }),
      });
    } catch (error) {
      console.error("Error updating game session:", error);
    }
  };

  const connectWebSocket = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
      return; // Already connecting
    }

    const ws = new WebSocket("wss://pumpportal.fun/api/data");
    wsRef.current = ws;

    // Add connection timeout
    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }, 10000); // 10 second timeout

    ws.onopen = () => {
      clearTimeout(connectionTimeout);
      setWsConnected(true);
      reconnectAttempts = 0; // Reset reconnection attempts on successful connection

      // Subscribe to token trades
      const tokensToWatch = ["FbAKcBJCeZgJskA2qdhtZumrtnC1R43W3JVWKthnpump"];

      const subscribeMessage = JSON.stringify({
        method: "subscribeTokenTrade",
        keys: tokensToWatch,
      });
      ws.send(subscribeMessage);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Check if this is a trade message (multiple ways it might be formatted)
        if (data.signature && data.mint) {
          // Security: Validate trade data and rate limiting
          if (!isValidTradeData(data) || isRateLimited()) {
            return; // Ignore invalid or rate limited trades
          }

          // Check if we have a valid current boss
          if (!currentBoss || !isValidBossState(currentBoss)) {
            return;
          }

            // Apply trade logic to boss health using current boss multipliers
            // Try different field names for SOL amount
            const solValue =
              data.solAmount || data.sol_amount || data.amount || 0;

            // Handle different txType formats
            const txType = data.txType?.toLowerCase();

            if (txType === "buy" || txType === "create") {
              const damage = solValue * currentBoss.damageMultiplier;

              // Set boss to hitting state temporarily
              setBossState("hitting");
              setIsAnimating(true);

              const newHealth = Math.max(0, currentBoss.currentHealth - damage);
              const isDefeated = newHealth <= 0;

              const updatedBoss = {
                ...currentBoss,
                currentHealth: newHealth,
                isDefeated,
              };

              setCurrentBoss(updatedBoss);

              setDamageText(`-${damage.toFixed(4)}`);
              setLastTradeActivity(`⚔️ BUY: -${damage.toFixed(4)} HP`);

              // Save trade to database
              saveTradeToDatabase({
                bossId: currentBoss.id,
                signature: data.signature,
                mint: data.mint,
                solAmount: solValue,
                tokenAmount: data.tokenAmount,
                txType: data.txType,
                damageDealt: damage,
                healApplied: 0,
                timestamp: new Date().toISOString(),
              });

              // Update boss in database
              updateBossInDatabase(currentBoss.id, newHealth, isDefeated, data.signature);

              // Update game session
              updateGameSession(damage, 0);

              // Check if boss died and move to next boss
              if (isDefeated) {
                setTimeout(() => {
                  loadNextBoss();
                }, 4000);
              }

              // Reset animation after 1.5 seconds
              setTimeout(() => {
                setIsAnimating(false);
                setBossState(isDefeated ? "dead" : "idle");
                setDamageText("");
                setLastTradeActivity("");
              }, 1500);
            } else if (txType === "sell") {
              const heal = solValue * currentBoss.healMultiplier;
              setBossState("healing");
              setIsAnimating(true);

              const newHealth = Math.min(
                currentBoss.maxHealth,
                currentBoss.currentHealth + heal
              );

              const updatedBoss = { ...currentBoss, currentHealth: newHealth };

              setCurrentBoss(updatedBoss);

              setHealText(`+${heal.toFixed(4)}`);
              setLastTradeActivity(`💚 SELL: +${heal.toFixed(4)} HP`);

              // Save trade to database
              saveTradeToDatabase({
                bossId: currentBoss.id,
                signature: data.signature,
                mint: data.mint,
                solAmount: solValue,
                tokenAmount: data.tokenAmount,
                txType: data.txType,
                damageDealt: 0,
                healApplied: heal,
                timestamp: new Date().toISOString(),
              });

              // Update boss in database
              updateBossInDatabase(currentBoss.id, newHealth, false, data.signature);

              // Update game session
              updateGameSession(0, heal);

              // Reset animation after 1.5 seconds
              setTimeout(() => {
                setIsAnimating(false);
                setBossState("idle");
                setHealText("");
                setLastTradeActivity("");
              }, 1500);
            }

          setTrades((prev) => [data, ...prev.slice(0, 10)]);
        }
      } catch (error) {
        console.error("❌ Error parsing WebSocket message:", error);
        console.error("❌ Raw message:", event.data);
      }
    };

    ws.onclose = (event) => {
      setWsConnected(false);
      // Safe auto-reconnect with exponential backoff
      safeReconnect();
    };

    ws.onerror = (error) => {
      console.error("❌ WebSocket error:", error);
      setWsConnected(false);
    };
  };

  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  // Load next boss when current one is defeated
  const loadNextBoss = async () => {
    try {
      const bossResponse = await fetch("/api/bosses?action=current");
      const bossData = await bossResponse.json();
      if (bossData.boss) {
        setCurrentBoss(bossData.boss);
        setBossState("idle");
      } else {
        setBossState("idle");
      }
    } catch (error) {
      console.error("Error loading next boss:", error);
    }
  };

  useEffect(() => {
    loadGameData();

    const initTimer = setTimeout(() => {
      connectWebSocket();
    }, 1000);

    return () => {
      clearTimeout(initTimer);
      disconnectWebSocket();
    };
  }, []);

  // Health check - ensure WebSocket stays connected
  useEffect(() => {
    const healthCheck = setInterval(() => {
      if (wsRef.current) {
        const state = wsRef.current.readyState;
        if (state === WebSocket.CLOSED || state === WebSocket.CLOSING) {
          reconnectAttempts = 0; // Reset attempts for health check reconnect
          connectWebSocket();
        } else if (state === WebSocket.OPEN && !wsConnected) {
          setWsConnected(true);
        }
      } else {
        reconnectAttempts = 0; // Reset attempts for health check reconnect
        connectWebSocket();
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(healthCheck);
  }, [wsConnected]);

  useEffect(() => {
    if (currentBoss && !wsConnected) {
      connectWebSocket();
    } else if (currentBoss) {
      // Boss already available monitoring
    }
  }, [currentBoss]);

  return (
    <div className="min-h-screen bg-black text-gray-300 overflow-hidden relative">
      {/* Creative Arena Background */}
      <div className="absolute inset-0 bg-linear-to-br from-gray-900 via-slate-900 to-black" />

      {/* Hexagonal Grid Pattern */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(139,92,246,0.1),transparent_50%)]" />
        <div
          className="absolute inset-0 bg-[conic-gradient(from_0deg_at_50%_50%,transparent_0deg,rgba(59,130,246,0.05)_60deg,transparent_120deg,rgba(139,92,246,0.08)_180deg,transparent_240deg,rgba(59,130,246,0.05)_300deg,transparent_360deg)] animate-spin"
          style={{ animationDuration: "20s" }}
        />
      </div>

      {/* Arena Border Lines */}
      <div className="absolute inset-4 opacity-30">
        <div className="absolute top-0 left-0 right-0 h-px bg-linear-to-r from-transparent via-purple-500/50 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-linear-to-r from-transparent via-purple-500/50 to-transparent" />
        <div className="absolute left-0 top-0 bottom-0 w-px bg-linear-to-b from-transparent via-blue-500/50 to-transparent" />
        <div className="absolute right-0 top-0 bottom-0 w-px bg-linear-to-b from-transparent via-blue-500/50 to-transparent" />
      </div>

      {/* Corner Accents */}
      <div className="absolute top-4 left-4 w-8 h-8 opacity-40">
        <div className="w-full h-full border-l-2 border-t-2 border-purple-400/60" />
        <div className="absolute inset-1 border border-purple-300/20" />
      </div>
      <div className="absolute top-4 right-4 w-8 h-8 opacity-40">
        <div className="w-full h-full border-r-2 border-t-2 border-purple-400/60" />
        <div className="absolute inset-1 border border-purple-300/20" />
      </div>
      <div className="absolute bottom-4 left-4 w-8 h-8 opacity-40">
        <div className="w-full h-full border-l-2 border-b-2 border-blue-400/60" />
        <div className="absolute inset-1 border border-blue-300/20" />
      </div>
      <div className="absolute bottom-4 right-4 w-8 h-8 opacity-40">
        <div className="w-full h-full border-r-2 border-b-2 border-blue-400/60" />
        <div className="absolute inset-1 border border-blue-300/20" />
      </div>

      {/* Side Panel Accents */}
      <div className="absolute top-1/2 left-2 w-1 h-16 opacity-30">
        <div className="w-full h-full bg-linear-to-b from-transparent via-purple-400/40 to-transparent" />
      </div>
      <div className="absolute top-1/2 right-2 w-1 h-16 opacity-30">
        <div className="w-full h-full bg-linear-to-b from-transparent via-blue-400/40 to-transparent" />
      </div>

      {/* Creative Header */}
      <div className="relative z-20 text-center py-8">
        {/* Decorative Lines */}
        <div className="flex items-center justify-center mb-4">
          <div className="w-16 h-px bg-linear-to-r from-transparent via-purple-500/60 to-transparent" />
          <div className="mx-4 w-2 h-2 bg-purple-500/80 rounded-full" />
          <div className="text-purple-400 text-sm font-bold tracking-widest">
            ⚔️
          </div>
          <div className="mx-4 w-2 h-2 bg-purple-500/80 rounded-full" />
          <div className="w-16 h-px bg-linear-to-r from-transparent via-purple-500/60 to-transparent" />
        </div>

        {/* Main Title */}
        <h1 className="text-5xl md:text-6xl font-black text-transparent bg-clip-text bg-linear-to-r from-white via-purple-200 to-white tracking-wider mb-2">
          BOSS RAID
        </h1>

        {/* Subtitle */}
        <p className="text-purple-300/80 text-sm font-medium tracking-widest uppercase">
          Real-time trading battle on Solana
        </p>
      </div>

      <div className="relative z-10 boss-raid-layout flex flex-col lg:flex-row items-center justify-center px-4">
        {/* Central Boss Arena */}
        <div className="boss-central flex-1 flex flex-col items-center justify-center max-w-2xl">
          {/* Main Boss Display */}
          {currentBoss ? (
            <div className="relative animate-fadeIn">
              {/* Clean Health UI - Above Boss */}
              <div className="mb-6 flex flex-col items-center space-y-3">
                {/* Boss Name */}
                <h3 className="text-2xl font-bold text-white">
                  {currentBoss.name}
                  <div className="flex items-center justify-center mb-10">
                    <div className="w-12 h-px bg-linear-to-r from-transparent via-blue-500/60 to-transparent" />
                    <div className="mx-3 text-blue-400 text-xs">◆</div>
                    <div className="w-12 h-px bg-linear-to-r from-transparent via-blue-500/60 to-transparent" />
                  </div>
                </h3>

                {/* Boss Arena Frame */}
              <div className="relative flex items-center justify-center">
                  {/* Outer Frame */}
                  <div className="absolute inset-0 scale-110">
                    {/* Hexagonal Border */}
                    <div className="relative w-full h-full">
                      <div className="absolute inset-2 border-2 border-purple-500/40 rounded-lg" />
                      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-2 w-4 h-4 border-l-2 border-r-2 border-t-2 border-purple-500/40 bg-black" />
                      <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-2 w-4 h-4 border-l-2 border-r-2 border-b-2 border-purple-500/40 bg-black" />
                      <div className="absolute left-0 top-1/2 transform -translate-x-2 -translate-y-1/2 w-4 h-4 border-l-2 border-t-2 border-b-2 border-purple-500/40 bg-black" />
                      <div className="absolute right-0 top-1/2 transform translate-x-2 -translate-y-1/2 w-4 h-4 border-r-2 border-t-2 border-b-2 border-purple-500/40 bg-black" />
                    </div>

                    {/* Corner Crystals */}
                    <div className="absolute -top-3 -left-3 w-6 h-6 bg-purple-500/20 border border-purple-400/50 transform rotate-45" />
                    <div className="absolute -top-3 -right-3 w-6 h-6 bg-purple-500/20 border border-purple-400/50 transform rotate-45" />
                    <div className="absolute -bottom-3 -left-3 w-6 h-6 bg-blue-500/20 border border-blue-400/50 transform rotate-45" />
                    <div className="absolute -bottom-3 -right-3 w-6 h-6 bg-blue-500/20 border border-blue-400/50 transform rotate-45" />

                    {/* Energy Rings */}
                    <div
                      className="absolute inset-0 rounded-full border border-purple-400/30 animate-ping"
                      style={{ animationDuration: "3s" }}
                    />
                    <div
                      className="absolute inset-4 rounded-full border border-blue-400/20 animate-ping"
                      style={{ animationDuration: "4s", animationDelay: "1s" }}
                    />
                  </div>

                  {/* Main Boss Image */}
                  <div className="relative z-10 overflow-hidden rounded-lg">
                    <div
                      className={`relative rounded-lg transition-all duration-500 ease-in-out transform ${
                      bossState === "dead"
                        ? "grayscale opacity-50 scale-90 filter brightness-50"
                        : bossState === "hitting"
                        ? "scale-110 brightness-110"
                        : bossState === "healing"
                        ? "scale-105 brightness-110"
                        : "scale-100 brightness-100"
                    } ${isAnimating ? "animate-pulse" : ""}`}
                  >
                    <Image
                      src={currentBoss.sprites[bossState]}
                      alt={`Boss ${currentBoss.name} ${bossState}`}
                        width={350}
                        height={350}
                        className="boss-image drop-shadow-2xl rounded-lg transition-all duration-700 ease-out"
                      priority
                    />

                    {/* Boss State Overlay Effects */}
                    {bossState === "hitting" && (
                        <div className="absolute inset-0 bg-red-500/15 rounded-full animate-ping" />
                    )}
                    {bossState === "healing" && (
                        <div className="absolute inset-0 bg-green-500/15 rounded-full animate-pulse" />
                    )}
                  </div>
                </div>

                {damageText && (
                  <div className="absolute top-1/4 left-1/2 transform -translate-x-1/2 animate-bounce">
                    <div className="relative">
                      <span className="text-red-400 text-6xl font-black animate-pulse drop-shadow-2xl">
                        {damageText}
                      </span>
                      <span className="absolute inset-0 text-red-400 text-6xl font-black blur-md animate-pulse">
                        {damageText}
                      </span>
                    </div>
                  </div>
                )}
                {healText && (
                  <div className="absolute top-1/4 left-1/2 transform -translate-x-1/2 animate-bounce">
                    <div className="relative">
                      <span className="text-green-400 text-6xl font-black animate-pulse drop-shadow-2xl">
                        {healText}
                      </span>
                      <span className="absolute inset-0 text-green-400 text-6xl font-black blur-md animate-pulse">
                        {healText}
                      </span>
                    </div>
                  </div>
                )}
              </div>

                {/* Creative Health Bar UI */}
                <div className="w-96 max-w-lg mt-10">
                  {/* Health Bar Frame */}
                  <div className="relative">
                    {/* Outer Hexagonal Frame */}
                    <div className="absolute -inset-2">
                      <div className="w-full h-full border-2 border-purple-500/30 rounded-lg relative">
                        <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-purple-500/40 border border-purple-400/60 rotate-45" />
                        <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-purple-500/40 border border-purple-400/60 rotate-45" />
                        <div className="absolute -left-1 top-1/2 transform -translate-y-1/2 w-2 h-2 bg-purple-500/40 border border-purple-400/60 rotate-45" />
                        <div className="absolute -right-1 top-1/2 transform -translate-y-1/2 w-2 h-2 bg-purple-500/40 border border-purple-400/60 rotate-45" />
                      </div>
                    </div>

                    {/* Inner Glow */}
                    <div className="absolute inset-0 bg-purple-500/5 rounded-lg blur-sm" />

                    {/* Health Bar */}
                    <div className="relative bg-gray-900/80 backdrop-blur-sm rounded-lg p-4 border border-gray-700/50">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                          <span className="text-red-400 font-bold text-sm tracking-wider">
                            HP
                          </span>
                        </div>
                        <div className="text-white font-mono text-sm">
                          {Number(currentBoss.currentHealth).toFixed(2)} /{" "}
                          {currentBoss.maxHealth}
                        </div>
                      </div>

                      <div className="relative">
                        <div className="w-full bg-gray-800/50 rounded-full h-6 border border-gray-600/50 overflow-hidden shadow-inner">
                          <div
                            className={`h-full transition-all duration-1000 ease-out relative rounded-full ${
                              currentBoss.currentHealth >
                              currentBoss.maxHealth * 0.6
                                ? "bg-linear-to-r from-green-500 via-green-400 to-emerald-500"
                                : currentBoss.currentHealth >
                                  currentBoss.maxHealth * 0.3
                                ? "bg-linear-to-r from-yellow-500 via-orange-500 to-red-500"
                                : "bg-linear-to-r from-red-600 via-red-500 to-red-700"
                            }`}
                            style={{
                              width: `${
                                (currentBoss.currentHealth /
                                  currentBoss.maxHealth) *
                                100
                              }%`,
                            }}
                          >
                            {/* Energy effect */}
                            <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/30 to-transparent animate-shine" />
                            <div className="absolute inset-0 bg-linear-to-r from-transparent to-black/20 rounded-full" />
                          </div>
                        </div>

                        {/* Percentage Display */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-white font-black text-lg drop-shadow-lg font-mono">
                            {(
                              (currentBoss.currentHealth /
                                currentBoss.maxHealth) *
                              100
                            ).toFixed(2)}
                            %
                          </span>
                        </div>

                        {/* Corner accents */}
                        <div className="absolute -top-1 -left-1 w-2 h-2 bg-purple-400/60 rounded-full animate-pulse" />
                        <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-400/60 rounded-full animate-pulse" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Creative Multipliers */}
                <div className="flex gap-8 mt-6">
                  {/* Damage Multiplier */}
                  <div className="relative">
                    <div className="flex items-center gap-3 bg-red-900/20 border border-red-500/30 rounded-lg px-4 py-2 backdrop-blur-sm">
                      <div className="relative">
                        <div className="w-8 h-8 bg-red-500/20 border border-red-400/50 rounded-full flex items-center justify-center">
                          <span className="text-red-400 text-lg">⚔️</span>
                        </div>
                        <div className="absolute -inset-1 bg-red-500/20 rounded-full animate-ping" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-red-400 font-bold text-lg">
                          {currentBoss.damageMultiplier}x
                        </span>
                        <span className="text-red-300/80 text-xs font-medium">
                          DAMAGE
                        </span>
                      </div>
                    </div>
                    {/* Corner accent */}
                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-400/60 rounded-full" />
                  </div>

                  {/* Heal Multiplier */}
                  <div className="relative">
                    <div className="flex items-center gap-3 bg-green-900/20 border border-green-500/30 rounded-lg px-4 py-2 backdrop-blur-sm">
                      <div className="relative">
                        <div className="w-8 h-8 bg-green-500/20 border border-green-400/50 rounded-full flex items-center justify-center">
                          <span className="text-green-400 text-lg">💚</span>
                        </div>
                        <div className="absolute -inset-1 bg-green-500/20 rounded-full animate-ping" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-green-400 font-bold text-lg">
                          {currentBoss.healMultiplier}x
                        </span>
                        <span className="text-green-300/80 text-xs font-medium">
                          HEAL
                        </span>
                      </div>
                    </div>
                    {/* Corner accent */}
                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-green-400/60 rounded-full" />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center animate-fadeIn">
              <div className="relative">
                {/* Loading/Boss not found message */}
                <div className="flex flex-col items-center space-y-4">
                  <div className="w-16 h-16 border-4 border-red-500/30 border-t-red-500 rounded-full animate-spin"></div>
                  <div className="text-center">
                    <h3 className="text-xl font-bold text-white mb-2">
                      Boss Not Loaded
                    </h3>
                    <p className="text-red-400 text-sm mb-2">
                      Trades are being ignored
                    </p>
                    <p className="text-gray-400 text-sm">
                      Click "Reload Boss" to fix
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-red-500">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                    <span>Critical: No boss available</span>
                  </div>
                </div>

                {/* Arena placeholder */}
                <div className="absolute inset-0 -z-10 flex items-center justify-center">
                  <div className="w-64 h-64 border-2 border-gray-700/50 rounded-lg flex items-center justify-center">
                    <div className="text-gray-600 text-sm">Arena</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
