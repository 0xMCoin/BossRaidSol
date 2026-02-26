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

// Formatar número de dano
function formatDamage(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(2)}M`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(2)}K`;
  }
  return amount.toFixed(2);
}

export default function Home() {
  const [bossState, setBossState] = useState<BossState>("idle");
  const [currentBoss, setCurrentBoss] = useState<DatabaseBoss | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [damageText, setDamageText] = useState<string>("");
  const [healText, setHealText] = useState<string>("");
  const [recentTrades, setRecentTrades] = useState<any[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [gameSession, setGameSession] = useState<any>(null);
  const [damageDealers, setDamageDealers] = useState<any[]>([]);
  const [damageLoading, setDamageLoading] = useState(true);
  const [damageError, setDamageError] = useState<string | null>(null);
  const [bossDefeated, setBossDefeated] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Token info constants
  const tokenMint = process.env.NEXT_PUBLIC_TOKEN_MINT || "";
  const twitterUrl = "https://x.com/CTWARS_SOL";

  // Format boss Twitter URL
  const getBossTwitterUrl = (twitter?: string): string | null => {
    if (!twitter || twitter === "") return null;

    // If it's already a full URL, return as is
    if (twitter.startsWith("http://") || twitter.startsWith("https://")) {
      return twitter;
    }

    // Remove @ if present and build URL
    const handle = twitter.replace(/^@/, "");
    return `https://x.com/${handle}`;
  };

  const bossTwitterUrl = getBossTwitterUrl(currentBoss?.twitter);

  // Map boss IDs to Twitter handles for tweet intent
  const getBossTwitterHandle = (bossId?: string, twitter?: string): string => {
    // Extract handle from Twitter URL if available
    if (twitter) {
      const match = twitter.match(/(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/([^\/\?]+)/i);
      if (match && match[1]) {
        return match[1];
      }
    }

    // Fallback mapping based on bossId
    const handleMap: Record<string, string> = {
      "quant-kid": "quantgz",
      "cooker-flips": "CookerFlips",
      "cupsey": "Cupseyy",
      "orangie": "orangie",
      "ninety": "98sThoughts",
      "gake": "ga__ke",
      "threadguy": "notthreadguy",
      "frankdegods": "frankdegods",
      "alon": "a1lon9",
      "hsaka": "HsakaTrades",
      "toly-wizard": "toly",
    };

    return handleMap[bossId || ""] || "ChillRaidFun";
  };

  // Generate tweet intent URL for current boss
  const getTweetIntentUrl = (): string => {
    const handle = getBossTwitterHandle(currentBoss?.bossId, currentBoss?.twitter);
    const tweetText = `Hey @${handle} — are you scared? Step into $CTWARS and kill your boss version. Only the KOL wallet can HitKill. ${process.env.NEXT_PUBLIC_TOKEN_MINT}`;
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
  };

  const tweetIntentUrl = getTweetIntentUrl();

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

      // Get trader wallet from trade data (try multiple possible field names)
      let traderWallet = data.traderPublicKey || data.trader_address || data.wallet || data.user || data.userPublicKey || null;

      // Check for boss wallet hitkill - only if boss has wallet configured
      if (currentBoss.wallet && currentBoss.wallet.trim() !== "" &&
        !currentBoss.isDefeated && currentBoss.currentHealth > 0) {

        // If we don't have trader wallet yet, try to fetch it from transaction
        // Only do this if boss has wallet configured (to avoid unnecessary RPC calls)
        if (!traderWallet && data.signature) {
          try {
            const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
            const { Connection } = await import("@solana/web3.js");
            const connection = new Connection(rpcUrl, "confirmed");

            const tx = await connection.getTransaction(data.signature, {
              maxSupportedTransactionVersion: 0,
            });

            if (tx && tx.transaction.message.staticAccountKeys.length > 0) {
              traderWallet = tx.transaction.message.staticAccountKeys[0].toBase58();
            }
          } catch (error) {
            console.log("Could not fetch trader address from transaction:", error);
            // Continue with normal trade processing if fetch fails
          }
        }

        // Check if trader wallet matches boss wallet for hitkill
        if (traderWallet && currentBoss.wallet.toLowerCase() === traderWallet.toLowerCase()) {
          // HITKILL - Instant kill the boss
          console.log(`[HITKILL] Boss ${currentBoss.name} killed by own wallet ${traderWallet}`);

          setCurrentBoss((prevBoss) => {
            if (!prevBoss) return prevBoss;

            const updatedBoss = {
              ...prevBoss,
              currentHealth: 0,
              isDefeated: true,
            };

            currentBossRef.current = updatedBoss;

            setBossState("dead");
            setBossDefeated(true);
            bossDefeatedRef.current = true;
            setDamageText("HITKILL!");

            // Save trade and update boss
            Promise.all([
              saveTradeToDatabase({
                bossId: prevBoss.id,
                signature: data.signature,
                mint: data.mint,
                solAmount: solValue,
                tokenAmount: data.tokenAmount,
                txType: data.txType,
                damageDealt: prevBoss.maxHealth, // Full health as damage for hitkill
                healApplied: 0,
                timestamp: new Date().toISOString(),
              }),
              updateBossInDatabase(
                prevBoss.id,
                0,
                true,
                data.signature,
                txType
              ),
              updateGameSession(prevBoss.maxHealth, 0),
            ]).catch((error) => {
              console.error("Error syncing hitkill to server:", error);
            });

            // Load next boss after delay
            setTimeout(() => {
              loadNextBoss();
            }, 3000);

            return updatedBoss;
          });

          return; // Exit early, hitkill processed
        }
      }

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

  const loadDamageDealers = async () => {
    if (!currentBoss) return;

    try {
      setDamageLoading(true);
      setDamageError(null);
      const response = await fetch(`/api/damage?bossId=${currentBoss.id}&limit=50`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error) {
        setDamageError(data.error);
        setDamageDealers([]);
      } else if (data.dealers && Array.isArray(data.dealers)) {
        setDamageDealers(data.dealers);
        setDamageError(null);
      } else {
        setDamageDealers([]);
        setDamageError("Formato de resposta inválido");
      }
    } catch (error: any) {
      console.error("Error loading damage dealers:", error);
      setDamageError(error?.message || "Erro ao carregar ranking de dano");
      setDamageDealers([]);
    } finally {
      setDamageLoading(false);
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
    if (currentBoss) {
      loadDamageDealers();
    }

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
    if (currentBoss) {
      loadDamageDealers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBoss]);

  useEffect(() => {
    const damageRefreshInterval = setInterval(() => {
      if (!damageLoading && currentBoss) {
        loadDamageDealers();
      }
    }, 30 * 1000); // Atualizar a cada 30 segundos

    return () => clearInterval(damageRefreshInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [damageLoading, currentBoss]);

  return (
    <div className="min-h-screen text-gray-300 overflow-hidden relative bg-[url('/images/bg.png')] bg-cover bg-center pb-10">
      {/* Starry Sky / Galaxy Background */}
      <div className="starry-sky opacity-50">
        {/* Nebulas */}
        <div className="galaxy-nebula nebula-1"></div>
        <div className="galaxy-nebula nebula-2"></div>
        <div className="galaxy-nebula nebula-3"></div>

        {/* Stars Layer */}
        <div className="stars">
          {/* Small stars */}
          {Array.from({ length: 150 }).map((_, i) => (
            <div
              key={`small-${i}`}
              className="star star-small"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                opacity: Math.random() * 0.5 + 0.3,
                animationDelay: `${Math.random() * 8}s`,
              }}
            />
          ))}
          {/* Medium stars */}
          {Array.from({ length: 50 }).map((_, i) => (
            <div
              key={`medium-${i}`}
              className="star star-medium"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                opacity: Math.random() * 0.5 + 0.5,
                animationDelay: `${Math.random() * 10}s`,
              }}
            />
          ))}
          {/* Large twinkling stars */}
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={`large-${i}`}
              className="star star-large star-twinkle"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                opacity: Math.random() * 0.3 + 0.7,
                animationDelay: `${Math.random() * 3}s`,
              }}
            />
          ))}
          {/* Drifting stars */}
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={`drift-${i}`}
              className="star star-medium star-drift"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                opacity: Math.random() * 0.4 + 0.6,
                animationDelay: `${Math.random() * 20}s`,
                animationDuration: `${15 + Math.random() * 10}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Battle Atmosphere Overlay */}
      <div className="absolute inset-0 opacity-10 z-10">
        <div className="absolute inset-0 bg-red-500/5" />
        <div className="absolute inset-0 bg-purple-500/5" />
        <div className="absolute inset-0 bg-blue-500/5" />
      </div>

      {/* Epic Battle Arena Border */}
      <div className="absolute inset-4 opacity-40">
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-500/60" />
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-red-500/60" />
        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-blue-500/60" />
        <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-blue-500/60" />
      </div>

      {/* Battle Corner Accents - Enhanced */}
      <div className="absolute top-4 left-4 w-12 h-12 opacity-60">
        <div className="w-full h-full border-l-[3px] border-t-[3px] border-red-400/70" />
        <div className="absolute inset-2 border border-red-300/30" />
        <div className="absolute top-1 left-1 w-2 h-2 bg-red-500/50 rounded-full" />
      </div>
      <div className="absolute top-4 right-4 w-12 h-12 opacity-60">
        <div className="w-full h-full border-r-[3px] border-t-[3px] border-purple-400/70" />
        <div className="absolute inset-2 border border-purple-300/30" />
        <div className="absolute top-1 right-1 w-2 h-2 bg-purple-500/50 rounded-full" />
      </div>
      <div className="absolute bottom-4 left-4 w-12 h-12 opacity-60">
        <div className="w-full h-full border-l-[3px] border-b-[3px] border-blue-400/70" />
        <div className="absolute inset-2 border border-blue-300/30" />
        <div className="absolute bottom-1 left-1 w-2 h-2 bg-blue-500/50 rounded-full" />
      </div>
      <div className="absolute bottom-4 right-4 w-12 h-12 opacity-60">
        <div className="w-full h-full border-r-[3px] border-b-[3px] border-purple-400/70" />
        <div className="absolute inset-2 border border-purple-300/30" />
        <div className="absolute bottom-1 right-1 w-2 h-2 bg-purple-500/50 rounded-full" />
      </div>

      {/* Battle Energy Orbs */}
      <div className="absolute top-1/2 left-4 w-2 h-24 opacity-50">
        <div className="w-full h-full bg-purple-400/60" />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-purple-500/70 rounded-full" />
      </div>
      <div className="absolute top-1/2 right-4 w-2 h-24 opacity-50">
        <div className="w-full h-full bg-blue-400/60" />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-blue-500/70 rounded-full" />
      </div>

      {/* Epic Battle Header */}
      <div className="relative z-20 text-center py-8">
        {/* Battle Decorative Lines - Enhanced */}
        <div className="flex items-center justify-center mb-6">
          <div className="w-24 h-[2px] bg-red-500/70" />
          <div className="mx-4 w-3 h-3 bg-red-500/80 rounded-full" />
          <div className="mx-2 text-red-400 text-xl font-black tracking-widest">
            RAID
          </div>
          <div className="mx-4 w-3 h-3 bg-red-500/80 rounded-full" />
          <div className="w-24 h-[2px] bg-red-500/70" />
        </div>

        {/* Epic Main Title */}
        <h1 className="text-6xl md:text-7xl font-black text-white tracking-wider mb-3 drop-shadow-2xl">
          {currentBoss ? (
            <>
              <span className="inline-block">BOSS:</span>{" "}
              <span className="inline-block">{currentBoss.name.toUpperCase()}</span>
            </>
          ) : (
            "LOADING..."
          )}
        </h1>

        <p className="text-purple-300/70 text-xs font-medium tracking-widest uppercase">
          Real-time trading battle on Solana
        </p>

        {/* Token CA and Twitter - Prominent Display */}
        <div className="mt-6 flex flex-col items-center justify-center gap-4">
          {/* Contract Address */}
          <div className="group relative bg-purple-900/40 border border-purple-500/30 rounded-xl px-6 py-3 hover:border-purple-400/50 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/20">
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <span className="text-xs text-purple-300/70 uppercase tracking-wider mb-1">Contract Address</span>
                <div className="flex items-center gap-2">
                  <code onClick={(e) => {
                    navigator.clipboard.writeText(tokenMint);
                    // Visual feedback
                    const btn = e.currentTarget;
                    const originalText = btn.innerHTML;
                    btn.classList.add("text-green-400");
                    setTimeout(() => {
                      btn.innerHTML = originalText;
                      btn.classList.remove("text-green-400");
                    }, 2000);
                  }} className="text-sm font-mono text-white font-semibold">
                    {tokenMint
                      ? `${tokenMint}`
                      : "Not configured"}
                  </code>
                </div>
              </div>
            </div>
            {/* Full address tooltip on hover */}
            {tokenMint && (
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900/95 border border-purple-500/50 rounded-lg text-xs font-mono text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-xl">
                {tokenMint}
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-px">
                  <div className="border-4 border-transparent border-t-gray-900/95"></div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-4">
            <a
              href={tweetIntentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative bg-blue-900/40 border border-blue-500/30 rounded-xl px-6 py-3 hover:border-blue-400/50 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/20 flex items-center gap-3"
            >
              <div className="flex flex-col">
                <span className="text-xs text-blue-300/70 uppercase tracking-wider mb-1">Tweet</span>
                <span className="text-sm font-semibold text-white">Invite KOL</span>
              </div>
            </a>

            <a
              href={twitterUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative bg-blue-900/40 border border-blue-500/30 rounded-xl px-6 py-3 hover:border-blue-400/50 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/20 flex items-center gap-3"
            >
              <div className="flex flex-col">
                <span className="text-xs text-blue-300/70 uppercase tracking-wider mb-1">Follow Us</span>
                <span className="text-sm font-semibold text-white">Twitter</span>
              </div>
            </a>

            {bossTwitterUrl && (
              <a
                href={bossTwitterUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative bg-blue-900/40 border border-blue-500/30 rounded-xl px-6 py-3 hover:border-blue-400/50 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/20 flex items-center gap-3"
              >
                <div className="flex flex-col">
                  <span className="text-xs text-blue-300/70 uppercase tracking-wider mb-1">Follow Boss</span>
                  <span className="text-sm font-semibold text-white">
                    {currentBoss?.name} Twitter
                  </span>
                </div>
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="relative z-10 boss-raid-layout flex flex-col xl:flex-row items-center justify-between px-4 gap-6 max-w-7xl mx-auto">
        {/* Left Panel - Top Damage Dealers - Battle Style */}
        <div className="left-panel w-full xl:w-80 flex flex-col space-y-4">
          <div className="bg-gray-900/60 border-2 border-red-500/30 rounded-xl p-4 h-96 xl:h-full shadow-2xl shadow-red-500/20 relative overflow-hidden">
            {/* Battle Panel Background Effect */}
            <div className="absolute inset-0 bg-red-500/5" />
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-500/60" />

            <div className="flex items-center justify-between mb-4 relative z-10">
              <h3 className="text-xl font-black text-red-400 flex items-center gap-2">
                <span>TOP DAMAGE</span>
              </h3>
              <div className="flex items-center gap-2">
                <div className={`text-xs font-bold px-3 py-1.5 rounded-full border-2 ${damageLoading
                  ? "text-yellow-400 bg-yellow-900/30 border-yellow-500/50"
                  : damageError
                    ? "text-red-400 bg-red-900/30 border-red-500/50"
                    : "text-green-400 bg-green-900/30 border-green-500/50"
                  }`}>
                  {damageLoading ? "LOADING" : damageError ? "ERROR" : "LIVE"}
                </div>
              </div>
            </div>
            <div className="space-y-2 overflow-y-auto h-72 xl:h-80 pr-2">
              {/* Battle Header */}
              <div className="flex justify-between text-xs font-bold text-gray-300 border-b-2 border-red-500/30 pb-2 mb-3 relative z-10">
                <span className="text-red-400">PLAYER</span>
                <span className="text-purple-400">NET DAMAGE</span>
              </div>

              {/* Loading State */}
              {damageLoading && (
                <div className="text-center text-gray-500 py-8">
                  <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full mx-auto mb-2"></div>
                  <p className="text-sm">Loading damage ranking...</p>
                  <p className="text-xs mt-1">Calculating damage</p>
                </div>
              )}

              {/* Error State */}
              {damageError && !damageLoading && (
                <div className="text-center py-8">
                  <div className="text-2xl mb-2"></div>
                  <p className="text-sm text-yellow-400">Erro ao carregar</p>
                  <p className="text-xs mt-1 text-gray-400 px-4">{damageError}</p>
                  <button
                    onClick={loadDamageDealers}
                    className="mt-3 text-xs bg-purple-500/20 hover:bg-purple-500/30 px-3 py-1.5 rounded transition-colors"
                  >
                    Tentar Novamente
                  </button>
                </div>
              )}

              {/* Damage Dealers List - Battle Style */}
              {!damageLoading &&
                !damageError &&
                damageDealers.length > 0 &&
                damageDealers.map((dealer) => (
                  <div
                    key={dealer.address}
                    className="flex justify-between items-center py-3 border-b border-red-500/20 hover:bg-red-500/10 rounded-lg px-3 -mx-3 transition-all duration-300 relative z-10 group"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border-2 shadow-lg ${dealer.rank === 1
                          ? "bg-yellow-500/30 text-yellow-200 border-yellow-400/60"
                          : dealer.rank === 2
                            ? "bg-gray-400/30 text-gray-200 border-gray-400/60"
                            : dealer.rank === 3
                              ? "bg-orange-500/30 text-orange-200 border-orange-400/60"
                              : "bg-red-500/30 text-red-200 border-red-400/60"
                          }`}
                      >
                        {dealer.rank}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm text-white font-bold font-mono group-hover:text-red-300 transition-colors">
                          {dealer.shortAddress}
                        </span>
                        <span className="text-xs text-gray-400">
                          {dealer.buyCount} buys, {dealer.sellCount} sells
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-lg text-red-400 font-black drop-shadow-lg group-hover:scale-110 transition-transform">
                        {dealer.formattedNetDamage}
                      </span>
                      <span className="text-xs text-gray-400">
                        {dealer.totalDamage > 0 && (
                          <span className="text-red-300 font-semibold">+{formatDamage(dealer.totalDamage)}</span>
                        )}
                        {dealer.totalHeal > 0 && (
                          <span className="text-green-300 font-semibold"> -{formatDamage(dealer.totalHeal)}</span>
                        )}
                      </span>
                    </div>
                  </div>
                ))}

              {/* Empty State */}
              {!damageLoading && !damageError && damageDealers.length === 0 && (
                <div className="text-center text-gray-500 py-8">
                  <div className="text-2xl mb-2"></div>
                  <p className="text-sm">No damage dealers yet</p>
                  <p className="text-xs mt-1">Start trading to appear here!</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Central Boss Arena */}
        <div className="boss-central flex-1 xl:flex-none xl:w-96 flex flex-col items-center justify-center max-w-2xl">
          {/* Main Boss Display */}
          {currentBoss ? (
            <div className="relative">
              {/* Clean Health UI - Above Boss */}
              <div className="mb-6 flex flex-col items-center space-y-3 mt-4">

                {/* Epic Boss Arena Frame */}
                <div className="relative flex items-center justify-center">
                  {/* Epic Outer Battle Frame */}
                  <div className="absolute inset-0 scale-110">
                    {/* Multi-layer Battle Border */}
                    <div className="relative w-full h-full">
                      <div className="absolute inset-2 border-[3px] border-red-500/50 rounded-xl shadow-lg shadow-red-500/30" />
                      <div className="absolute inset-4 border-2 border-purple-500/40 rounded-lg" />
                      <div className="absolute inset-6 border border-blue-500/30 rounded-md" />

                      {/* Battle Corner Spikes */}
                      <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-3 w-6 h-6 border-l-[3px] border-r-[3px] border-t-[3px] border-red-500/60 bg-black rotate-45" />
                      <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-3 w-6 h-6 border-l-[3px] border-r-[3px] border-b-[3px] border-red-500/60 bg-black rotate-45" />
                      <div className="absolute left-0 top-1/2 transform -translate-x-3 -translate-y-1/2 w-6 h-6 border-l-[3px] border-t-[3px] border-b-[3px] border-blue-500/60 bg-black rotate-45" />
                      <div className="absolute right-0 top-1/2 transform translate-x-3 -translate-y-1/2 w-6 h-6 border-r-[3px] border-t-[3px] border-b-[3px] border-blue-500/60 bg-black rotate-45" />
                    </div>

                    {/* Epic Corner Crystals - Enhanced */}
                    <div className="absolute -top-4 -left-4 w-8 h-8 bg-red-500/30 border-2 border-red-400/70 transform rotate-45 shadow-lg shadow-red-500/50" />
                    <div className="absolute -top-4 -right-4 w-8 h-8 bg-purple-500/30 border-2 border-purple-400/70 transform rotate-45 shadow-lg shadow-purple-500/50" />
                    <div className="absolute -bottom-4 -left-4 w-8 h-8 bg-blue-500/30 border-2 border-blue-400/70 transform rotate-45 shadow-lg shadow-blue-500/50" />
                    <div className="absolute -bottom-4 -right-4 w-8 h-8 bg-purple-500/30 border-2 border-purple-400/70 transform rotate-45 shadow-lg shadow-purple-500/50" />

                    {/* Battle Energy Rings - Multi-layer */}
                    <div className="absolute inset-0 rounded-full border-2 border-red-400/40" />
                    <div className="absolute inset-4 rounded-full border-2 border-purple-400/30" />
                    <div className="absolute inset-8 rounded-full border border-blue-400/20" />

                    {/* Battle Aura Effect */}
                    <div className="absolute inset-0 rounded-full bg-red-500/10" />
                  </div>

                  {/* Epic Main Boss Image */}
                  <div className="relative z-10 overflow-hidden rounded-xl">
                    <div
                      className={`relative rounded-xl transition-all duration-500 ease-in-out transform ${bossState === "dead"
                        ? "grayscale opacity-50 scale-90 filter brightness-50"
                        : bossState === "hitting"
                          ? "scale-115 brightness-125"
                          : bossState === "healing"
                            ? "scale-110 brightness-115"
                            : "scale-100 brightness-100"
                        }`}
                    >
                      <Image
                        src={currentBoss.sprites[bossState]}
                        alt={`Boss ${currentBoss.name} ${bossState}`}
                        width={350}
                        height={350}
                        className="boss-image drop-shadow-2xl rounded-xl transition-all duration-700 ease-out scale-125"
                        priority
                      />

                      {/* Epic Boss State Overlay Effects */}
                      {bossState === "hitting" && (
                        <>
                          <div className="absolute inset-0 bg-red-500/20 rounded-full" />
                          <div className="absolute inset-0 bg-red-500/30 rounded-xl" />
                          <div className="absolute inset-0 border-4 border-red-500/50 rounded-xl" />
                        </>
                      )}
                      {bossState === "healing" && (
                        <>
                          <div className="absolute inset-0 bg-green-500/20 rounded-full" />
                          <div className="absolute inset-0 bg-green-500/30 rounded-xl" />
                          <div className="absolute inset-0 border-4 border-green-500/50 rounded-xl" />
                        </>
                      )}
                    </div>
                  </div>

                  {damageText && (
                    <div className="absolute top-1/4 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none">
                      <div className="relative">
                        <span className="text-red-400 text-7xl md:text-8xl font-black drop-shadow-2xl">
                          {damageText}
                        </span>
                      </div>
                    </div>
                  )}
                  {healText && (
                    <div className="absolute top-1/4 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none">
                      <div className="relative">
                        <span className="text-green-400 text-7xl md:text-8xl font-black drop-shadow-2xl">
                          {healText}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Epic Battle Health Bar UI */}
                <div className="w-96 max-w-lg mt-10">
                  {/* Epic Health Bar Frame */}
                  <div className="relative">
                    {/* Multi-layer Battle Frame */}
                    <div className="absolute -inset-3">
                      <div className="w-full h-full border-[3px] border-red-500/40 rounded-xl relative shadow-lg shadow-red-500/30">
                        <div className="absolute -top-2 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-red-500/60 border-2 border-red-400/80 rotate-45" />
                        <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-red-500/60 border-2 border-red-400/80 rotate-45" />
                        <div className="absolute -left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 bg-purple-500/60 border-2 border-purple-400/80 rotate-45" />
                        <div className="absolute -right-2 top-1/2 transform -translate-y-1/2 w-3 h-3 bg-purple-500/60 border-2 border-purple-400/80 rotate-45" />
                      </div>
                    </div>

                    {/* Inner Battle Glow */}
                    <div className="absolute inset-0 bg-red-500/10 rounded-xl" />

                    {/* Epic Health Bar Container */}
                    <div className="relative bg-gray-900/90 rounded-xl p-5 border-2 border-red-500/30 shadow-2xl">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 bg-red-500 rounded-full shadow-lg shadow-red-500/50" />
                          <span className="text-red-400 font-black text-base tracking-widest uppercase">
                            HEALTH POINTS
                          </span>
                        </div>
                        <div className="text-white font-mono text-sm font-bold px-3 py-1 rounded-lg border border-gray-700/50">
                          {Number(currentBoss.currentHealth).toFixed(2)} /{" "}
                          {currentBoss.maxHealth}
                        </div>
                      </div>

                      <div className="relative">
                        {/* Health Bar Background */}
                        <div className="w-full rounded-full h-8 border-2 border-gray-700/70 overflow-hidden shadow-inner">
                          <div
                            className={`h-full transition-all duration-1000 ease-out relative rounded-full ${currentBoss.currentHealth >
                              currentBoss.maxHealth * 0.6
                              ? "bg-green-500"
                              : currentBoss.currentHealth >
                                currentBoss.maxHealth * 0.3
                                ? "bg-yellow-500"
                                : "bg-red-700"
                              }`}
                            style={{
                              width: `${(currentBoss.currentHealth /
                                currentBoss.maxHealth) *
                                100
                                }%`,
                            }}
                          >

                            {/* Health bar glow */}
                            {currentBoss.currentHealth <= currentBoss.maxHealth * 0.3 && (
                              <div className="absolute inset-0 bg-red-500/30 rounded-full" />
                            )}
                          </div>
                        </div>

                        {/* Epic Percentage Display */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-white font-black text-xl md:text-2xl drop-shadow-2xl font-mono">
                            {(
                              (currentBoss.currentHealth /
                                currentBoss.maxHealth) *
                              100
                            ).toFixed(2)}
                            %
                          </span>
                        </div>

                        {/* Battle Corner accents - Enhanced */}
                        <div className="absolute -top-2 -left-2 w-3 h-3 bg-red-400/70 rounded-full shadow-lg shadow-red-500/50" />
                        <div className="absolute -top-2 -right-2 w-3 h-3 bg-purple-400/70 rounded-full shadow-lg shadow-purple-500/50" />
                        <div className="absolute -bottom-2 -left-2 w-3 h-3 bg-blue-400/70 rounded-full shadow-lg shadow-blue-500/50" />
                        <div className="absolute -bottom-2 -right-2 w-3 h-3 bg-purple-400/70 rounded-full shadow-lg shadow-purple-500/50" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <div className="relative">
                {/* Loading/Boss not found message */}
                <div className="flex flex-col items-center space-y-4">
                  <div className="w-16 h-16 border-4 border-red-500/30 border-t-red-500 rounded-full"></div>
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
                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
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

        {/* Right Panel - Trade Monitor - Battle Style */}
        <div className="right-panel w-full xl:w-80 flex flex-col space-y-4">
          <div className="bg-gray-900/60 border-2 border-blue-500/30 rounded-xl p-4 h-96 xl:h-full shadow-2xl shadow-blue-500/20 relative overflow-hidden">
            {/* Battle Panel Background Effect */}
            <div className="absolute inset-0 bg-blue-500/5" />
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-blue-500/60" />

            <div className="flex items-center justify-between mb-4 relative z-10">
              <h3 className="text-xl font-black text-blue-400 flex items-center gap-2">
                <span></span>
                <span>TRADE MONITOR</span>
              </h3>
              <div className="text-xs font-bold text-green-400 bg-green-900/30 border-2 border-green-500/50 px-3 py-1.5 rounded-full">
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
                    className={`flex items-center justify-between py-3 border-b ${trade.type === "buy"
                      ? "border-red-500/20 hover:bg-red-500/10"
                      : "border-green-500/20 hover:bg-green-500/10"
                      } rounded-lg px-3 -mx-3 transition-all duration-300 relative z-10 group`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold border-2 shadow-lg ${trade.type === "buy"
                          ? "bg-red-500/30 text-red-200 border-red-400/60 group-hover:scale-110 transition-transform"
                          : "bg-green-500/30 text-green-200 border-green-400/60 group-hover:scale-110 transition-transform"
                          }`}
                      >
                        {trade.type === "buy" ? "ATK" : "HEAL"}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-white group-hover:text-purple-300 transition-colors">
                          {trade.solAmount.toFixed(4)} SOL
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(trade.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-lg font-black drop-shadow-lg group-hover:scale-110 transition-transform ${trade.type === "buy"
                          ? "text-red-400"
                          : "text-green-400"
                          }`}
                      >
                        {trade.type === "buy"
                          ? `-${Math.round(trade.damage)} HP`
                          : `+${Math.round(trade.heal)} HP`}
                      </div>
                      <div className="text-xs text-gray-400 font-semibold">
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
