"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import type { Boss as DatabaseBoss } from "@/lib/db/database";

const tradeTimestamps: number[] = [];
const RATE_LIMIT = 10;
const RATE_WINDOW = 1000;

const processedTrades = new Set<string>();

// Sistema de fila para limitar requisições pendentes
const requestQueue: Array<() => Promise<any>> = [];
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 3;

const processQueue = async () => {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS || requestQueue.length === 0) {
    return;
  }

  const nextRequest = requestQueue.shift();
  if (!nextRequest) return;

  activeRequests++;
  try {
    await nextRequest();
  } catch (error) {
    console.error("Queue request error:", error);
  } finally {
    activeRequests--;
    // Processar próximo item da fila
    processQueue();
  }
};

const queueRequest = <T,>(requestFn: () => Promise<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    requestQueue.push(async () => {
      try {
        const result = await requestFn();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    processQueue();
  });
};

const isValidTradeData = (data: any): boolean => {
  const mint = process.env.NEXT_PUBLIC_TOKEN_MINT || "";
  const solValue = data.solAmount || data.sol_amount || data.amount || 0;
  return (
    data.signature &&
    data.mint &&
    typeof solValue === "number" &&
    solValue > 0 &&
    solValue < 1000 &&
    ["buy", "sell"].includes(data.txType?.toLowerCase()) &&
    data.mint === mint
  );
};

const isRateLimited = (): boolean => {
  const now = Date.now();
  tradeTimestamps.push(now);
  while (tradeTimestamps.length > 0 && tradeTimestamps[0] < now - RATE_WINDOW) {
    tradeTimestamps.shift();
  }

  return tradeTimestamps.length > RATE_LIMIT;
};

const API_KEY = process.env.NEXT_PUBLIC_BOSS_RAID_API_KEY || "";

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1000;

type BossState = "idle" | "hitting" | "healing" | "dead";

export default function Home() {
  const [bossState, setBossState] = useState<BossState>("idle");
  const [currentBoss, setCurrentBoss] = useState<DatabaseBoss | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [damageText, setDamageText] = useState<string>("");
  const [healText, setHealText] = useState<string>("");
  const [recentTrades, setRecentTrades] = useState<any[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [gameSession, setGameSession] = useState<any>(null);
  const [holders, setHolders] = useState<any[]>([]);
  const [holdersLoading, setHoldersLoading] = useState(true);
  const [holdersError, setHoldersError] = useState<string | null>(null);
  const [bossDefeated, setBossDefeated] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Refs para acessar valores atuais sem causar re-renders
  const currentBossRef = useRef<DatabaseBoss | null>(null);
  const bossDefeatedRef = useRef(false);
  const gameSessionRef = useRef<any>(null);

  // Atualizar refs quando estados mudarem
  useEffect(() => {
    currentBossRef.current = currentBoss;
  }, [currentBoss]);

  useEffect(() => {
    bossDefeatedRef.current = bossDefeated;
  }, [bossDefeated]);

  useEffect(() => {
    gameSessionRef.current = gameSession;
  }, [gameSession]);

  // Helper functions - Versões otimizadas com fila
  const saveTradeToDatabase = async (tradeData: any) => {
    return queueRequest(async () => {
      try {
        const response = await fetch("/api/trades", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(tradeData),
        });
        if (!response.ok) {
          console.error(
            "Trade API failed:",
            response.status,
            await response.text()
          );
        }
      } catch (error) {
        console.error("Error saving trade:", error);
      }
    });
  };

  const updateBossInDatabase = async (
    bossId: number,
    health: number,
    isDefeated: boolean = false,
    tradeSignature?: string,
    txType?: string
  ) => {
    return queueRequest(async () => {
      try {
        const requestData = {
          action: "updateHealth",
          bossId,
          currentHealth: health,
          isDefeated,
          signature: tradeSignature,
          txType,
        };
        const response = await fetch("/api/bosses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
          },
          body: JSON.stringify(requestData),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Boss update failed:", response.status, errorText);
          return null;
        }

        const responseData = await response.json();
        return responseData;
      } catch (error) {
        console.error("Error updating boss:", error);
        return null;
      }
    });
  };

  const updateGameSession = useCallback(
    async (
      damageDealt: number = 0,
      healApplied: number = 0,
      newBossId?: number
    ) => {
      const session = gameSessionRef.current;
      if (!session) return;

      return queueRequest(async () => {
        try {
          await fetch("/api/game", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              action: "updateSession",
              sessionId: session.id,
              damageDealt,
              healApplied,
              newBossId,
            }),
          });
        } catch (error) {
          console.error("Error updating game session:", error);
        }
      });
    },
    []
  );

  const loadNextBoss = async () => {
    try {
      const bossResponse = await fetch("/api/bosses?action=current");
      const bossData = await bossResponse.json();
      if (bossData.boss) {
        setCurrentBoss(bossData.boss);
        setBossState("idle");
        setBossDefeated(false); // Reset defeat state for new boss
        setIsAnimating(false);
        setDamageText("");
        setHealText("");
      } else {
        console.warn("No boss returned from API");
        setBossState("idle");
      }
    } catch (error) {
      console.error("Error loading next boss:", error);
    }
  };

  const processTrade = useCallback(async (data: any) => {
    try {
      if (bossDefeatedRef.current) {
        return;
      }

      const currentBoss = currentBossRef.current;
      if (!currentBoss) {
        return;
      }
      if (currentBoss.isDefeated) {
        return;
      }

      const solValue = data.solAmount || data.sol_amount || data.amount || 0;
      const txType = data.txType?.toLowerCase();

      if (txType === "buy" || txType === "create") {
        setCurrentBoss((prevBoss) => {
          if (!prevBoss) return prevBoss;
          
          const damage = solValue * 200 * prevBoss.buyWeight;
          
          const newHealth = Math.max(0, prevBoss.currentHealth - damage);
          const isDefeated = newHealth <= 0;
          
          const updatedBoss = {
            ...prevBoss,
            currentHealth: newHealth,
            isDefeated,
          };
          
          // Atualizar ref imediatamente
          currentBossRef.current = updatedBoss;

          // Atualizar UI primeiro para resposta imediata
          setBossState("hitting");
          setIsAnimating(true);
          setDamageText(`-${damage.toFixed(4)}`);

          // Adicionar trade ao monitor imediatamente
          const newTrade = {
            id: Date.now(),
            type: "buy",
            solAmount: solValue,
            damage,
            timestamp: new Date().toISOString(),
            bossName: prevBoss.name,
          };
          setRecentTrades((prev: any[]) => {
            return [newTrade, ...prev.slice(0, 9)];
          });

          // Chamadas ao servidor em paralelo (sem bloquear UI)
          Promise.all([
            saveTradeToDatabase({
              bossId: prevBoss.id,
              signature: data.signature,
              mint: data.mint,
              solAmount: solValue,
              tokenAmount: data.tokenAmount,
              txType: data.txType,
              damageDealt: damage,
              healApplied: 0,
              timestamp: new Date().toISOString(),
            }),
            updateBossInDatabase(
              prevBoss.id,
              newHealth,
              isDefeated,
              data.signature,
              txType
            ),
            updateGameSession(damage, 0),
          ]).catch((error) => {
            console.error("Error syncing trade to server:", error);
          });

          if (isDefeated) {
            setBossDefeated(true);
            bossDefeatedRef.current = true;
            setBossState("dead");
            setTimeout(() => {
              loadNextBoss();
            }, 5000);
          } else {
            setTimeout(() => {
              setIsAnimating(false);
              setBossState("idle");
              setDamageText("");
            }, 1500);
          }

          return updatedBoss;
        });
        
        return; // Retornar aqui pois toda a lógica está dentro do setState
      } else if (txType === "sell") {
        // Não permitir curar um boss que já está derrotado
        if (currentBoss.isDefeated || currentBoss.currentHealth <= 0) {
          return;
        }
        
        // Usar atualização funcional para garantir que sempre usamos o valor mais recente
        setCurrentBoss((prevBoss) => {
          if (!prevBoss) return prevBoss;
          
          // Verificar novamente dentro do setState para evitar race conditions
          if (prevBoss.isDefeated || prevBoss.currentHealth <= 0) {
            return prevBoss;
          }
          
          const heal = solValue * 200 * prevBoss.sellWeight;
          
          const newHealth = Math.min(
            prevBoss.maxHealth,
            prevBoss.currentHealth + heal
          );

          const updatedBoss = { ...prevBoss, currentHealth: newHealth };
          
          // Atualizar ref imediatamente
          currentBossRef.current = updatedBoss;

          // Atualizar UI primeiro para resposta imediata
          setBossState("healing");
          setIsAnimating(true);
          setHealText(`+${heal.toFixed(4)}`);

          // Adicionar trade ao monitor imediatamente
          const newTrade = {
            id: Date.now(),
            type: "sell",
            solAmount: solValue,
            heal,
            timestamp: new Date().toISOString(),
            bossName: prevBoss.name,
          };
          setRecentTrades((prev: any[]) => {
            return [newTrade, ...prev.slice(0, 9)];
          });

          // Chamadas ao servidor em paralelo (sem bloquear UI)
          Promise.all([
            saveTradeToDatabase({
              bossId: prevBoss.id,
              signature: data.signature,
              mint: data.mint,
              solAmount: solValue,
              tokenAmount: data.tokenAmount,
              txType: data.txType,
              damageDealt: 0,
              healApplied: heal,
              timestamp: new Date().toISOString(),
            }),
            updateBossInDatabase(
              prevBoss.id,
              newHealth,
              false,
              data.signature,
              txType
            ),
            updateGameSession(0, heal),
          ]).catch((error) => {
            console.error("Error syncing trade to server:", error);
          });

          setTimeout(() => {
            setIsAnimating(false);
            setBossState("idle");
            setHealText("");
          }, 1500);

          return updatedBoss;
        });
      }
    } catch (error) {
      console.error("Error processing trade:", error);
      throw error;
    }
  }, []);

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
    } catch (error) {
      console.error("Error loading game data:", error);
    }
  };

  const loadHolders = async () => {
    try {
      setHoldersLoading(true);
      setHoldersError(null);
      const response = await fetch("/api/holders?limit=50");
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();

      if (data.error) {
        // Se for erro de limitação do RPC, mostrar mensagem mais amigável
        if (data.isRpcLimit || response.status === 503) {
          setHoldersError(
            "Este token tem muitos holders. O RPC atual não consegue buscar todos de uma vez. " +
            "Os holders podem aparecer parcialmente ou não aparecer."
          );
        } else {
          setHoldersError(data.error);
        }
        setHolders([]);
      } else if (data.holders && Array.isArray(data.holders)) {
        setHolders(data.holders);
        setHoldersError(null);
      } else {
        // Se não tem estrutura esperada, tentar usar como array direto (fallback)
        if (Array.isArray(data)) {
          setHolders(data);
        } else {
          setHolders([]);
          setHoldersError("Formato de resposta inválido");
        }
      }
    } catch (error: any) {
      console.error("Error loading holders:", error);
      setHoldersError(error?.message || "Erro ao carregar holders");
      setHolders([]);
    } finally {
      setHoldersLoading(false);
    }
  };

  const connectWebSocket = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
      return;
    }
    const apiKey = process.env.NEXT_PUBLIC_BOSS_RAID_API_KEY;
    if (!apiKey) {
      console.error("API key is not set");
      return;
    }
    const ws = new WebSocket(`wss://pumpportal.fun/api/data?api-key=${apiKey}`);
    wsRef.current = ws;

    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }, 10000);

    ws.onopen = () => {
      clearTimeout(connectionTimeout);
      setWsConnected(true);
      reconnectAttempts = 0;
      const mint = process.env.NEXT_PUBLIC_TOKEN_MINT || "";
      if (!mint) {
        console.error("❌ Mint is not set");
        return;
      }
      const subscribeMessage = JSON.stringify({
        method: "subscribeTokenTrade",
        keys: [mint],
      });
      ws.send(subscribeMessage);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.signature && data.mint) {
          if (!isValidTradeData(data)) {
            return;
          }
          if (isRateLimited()) {
            return;
          }
          if (processedTrades.has(data.signature)) {
            return;
          }
          processedTrades.add(data.signature);
          if (processedTrades.size > 1000) {
            const recentTrades = Array.from(processedTrades).slice(-500);
            processedTrades.clear();
            recentTrades.forEach((signature) => processedTrades.add(signature));
          }
          processTrade(data).catch((error) => {
            console.error("Trade processing failed:", error);
            processedTrades.delete(data.signature);
          });
        }
      } catch (error) {
        console.error("❌ Error parsing WebSocket message:", error);
        console.error("❌ Raw message:", event.data);
      }
    };

    ws.onclose = (event) => {
      setWsConnected(false);
      // Safe reconnect logic
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = BASE_RECONNECT_DELAY * reconnectAttempts;
        setTimeout(() => {
          connectWebSocket();
        }, delay);
      }
    };

    ws.onerror = (error) => {
      console.error("❌ WebSocket error:", error);
      setWsConnected(false);
    };
  }, [processTrade]);

  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  useEffect(() => {
    loadGameData();
    loadHolders();

    const initTimer = setTimeout(() => {
      connectWebSocket();
    }, 1000);

    return () => {
      clearTimeout(initTimer);
      disconnectWebSocket();
    };
  }, [connectWebSocket]);

  useEffect(() => {
    const healthCheck = setInterval(() => {
      if (wsRef.current) {
        const state = wsRef.current.readyState;
        if (state === WebSocket.CLOSED || state === WebSocket.CLOSING) {
          reconnectAttempts = 0;
          connectWebSocket();
        } else if (state === WebSocket.OPEN && !wsConnected) {
          setWsConnected(true);
        }
      } else {
        reconnectAttempts = 0;
        connectWebSocket();
      }
    }, 30000);

    return () => clearInterval(healthCheck);
  }, [wsConnected, connectWebSocket]);

  useEffect(() => {
    if (currentBoss && !wsConnected) {
      connectWebSocket();
    }
  }, [currentBoss, wsConnected, connectWebSocket]);

  useEffect(() => {
    const holdersRefreshInterval = setInterval(() => {
      if (!holdersLoading) {
        loadHolders();
      }
    }, 5 * 60 * 1000);

    return () => clearInterval(holdersRefreshInterval);
  }, [holdersLoading]);

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
          Boss: {currentBoss ? currentBoss.name : "Loading..."}
        </h1>

        {/* Subtitle */}
        <p className="text-purple-300/80 text-sm font-medium tracking-widest uppercase">
          Real-time trading battle on Solana
        </p>
      </div>

      <div className="relative z-10 boss-raid-layout flex flex-col xl:flex-row items-center justify-between px-4 gap-6 max-w-7xl mx-auto">
        {/* Left Panel - Top Holders */}
        <div className="left-panel w-full xl:w-80 flex flex-col space-y-4">
          <div className="bg-gray-900/40 backdrop-blur-sm border border-purple-500/20 rounded-xl p-4 h-96 xl:h-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-purple-300 flex items-center gap-2">
                Top Holders
              </h3>
              <div className="flex items-center gap-2">
                <div className="text-xs text-purple-400 bg-purple-900/30 px-2 py-1 rounded-full">
                  {holdersLoading ? "LOADING" : holdersError ? "ERROR" : "LIVE"}
                </div>
              </div>
            </div>
            <div className="space-y-2 overflow-y-auto h-72 xl:h-80 pr-2">
              {/* Header */}
              <div className="flex justify-between text-xs text-gray-400 border-b border-gray-700 pb-2 mb-2">
                <span>Holder</span>
                <span>Amount</span>
              </div>

              {/* Loading State */}
              {holdersLoading && (
                <div className="text-center text-gray-500 py-8">
                  <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-2"></div>
                  <p className="text-sm">Loading holders...</p>
                  <p className="text-xs mt-1">Querying blockchain</p>
                </div>
              )}

              {/* Error State */}
              {holdersError && !holdersLoading && (
                <div className="text-center py-8">
                  <div className="text-2xl mb-2">⚠️</div>
                  <p className="text-sm text-yellow-400">Limitação do RPC</p>
                  <p className="text-xs mt-1 text-gray-400 px-4">{holdersError}</p>
                  {!holdersError.includes("muitos holders") && (
                    <button
                      onClick={loadHolders}
                      className="mt-3 text-xs bg-purple-500/20 hover:bg-purple-500/30 px-3 py-1.5 rounded transition-colors"
                    >
                      Tentar Novamente
                    </button>
                  )}
                </div>
              )}

              {/* Holders List */}
              {!holdersLoading &&
                !holdersError &&
                holders.length > 0 &&
                holders.map((holder) => (
                  <div
                    key={holder.address}
                    className="flex justify-between items-center py-2 border-b border-gray-800/50 hover:bg-gray-800/20 rounded px-2 -mx-2 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          holder.rank === 1
                            ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"
                            : holder.rank === 2
                            ? "bg-gray-400/20 text-gray-300 border border-gray-400/30"
                            : holder.rank === 3
                            ? "bg-orange-500/20 text-orange-300 border border-orange-500/30"
                            : "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                        }`}
                      >
                        {holder.rank <= 3 ? "🏆" : holder.rank}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm text-gray-300 font-mono">
                          {holder.shortAddress}
                        </span>
                        <span className="text-xs text-gray-500">
                          {holder.percentage.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <span className="text-sm text-purple-300 font-bold">
                      {holder.formattedAmount}
                    </span>
                  </div>
                ))}

              {/* Empty State */}
              {!holdersLoading && !holdersError && holders.length === 0 && (
                <div className="text-center text-gray-500 py-8">
                  <div className="text-2xl mb-2">📊</div>
                  <p className="text-sm">No holders found</p>
                  <p className="text-xs mt-1">Token may have no holders yet</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Central Boss Arena */}
        <div className="boss-central flex-1 xl:flex-none xl:w-96 flex flex-col items-center justify-center max-w-2xl">
          {/* Main Boss Display */}
          {currentBoss ? (
            <div className="relative animate-fadeIn">
              {/* Clean Health UI - Above Boss */}
              <div className="mb-6 flex flex-col items-center space-y-3">
                {/* Boss Name */}
                <h3 className="text-2xl font-bold text-white text-center">
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
                        className="boss-image drop-shadow-2xl rounded-lg transition-all duration-700 ease-out scale-125"
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

        {/* Right Panel - Trade Monitor */}
        <div className="right-panel w-full xl:w-80 flex flex-col space-y-4">
          <div className="bg-gray-900/40 backdrop-blur-sm border border-purple-500/20 rounded-xl p-4 h-96 xl:h-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-purple-300 flex items-center gap-2">
                Trade Monitor
              </h3>
              <div className="text-xs text-purple-400 bg-purple-900/30 px-2 py-1 rounded-full">
                LIVE
              </div>
            </div>
            <div className="space-y-2 overflow-y-auto h-72 xl:h-80 pr-2">
              {recentTrades.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <p className="text-sm">Trades will appear here</p>
                  <p className="text-xs mt-1">Waiting for activity...</p>
                </div>
              ) : (
                recentTrades.map((trade, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-2 border-b border-gray-800/30"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                          trade.type === "buy"
                            ? "bg-red-500/20 text-red-300 border border-red-500/30"
                            : "bg-green-500/20 text-green-300 border border-green-500/30"
                        }`}
                      >
                        {trade.type === "buy" ? "🗡️" : "💚"}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-300">
                          {trade.solAmount.toFixed(4)} SOL
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(trade.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-sm font-bold ${
                          trade.type === "buy"
                            ? "text-red-400"
                            : "text-green-400"
                        }`}
                      >
                        {trade.type === "buy"
                          ? `-${Math.round(trade.damage)} HP`
                          : `+${Math.round(trade.heal)} HP`}
                      </div>
                      <div className="text-xs text-gray-500">
                        {trade.bossName}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
