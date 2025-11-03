import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, type ParsedAccountData } from "@solana/web3.js";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

interface TokenHolder {
  address: string;
  shortAddress: string;
  amount: number;
  percentage: number;
  rank: number;
  formattedAmount: string;
}

const TOKEN_MINT = process.env.NEXT_PUBLIC_TOKEN_MINT || "FTtNADjfMjaT8EYBDXujrLpbGZhjgJNWhYAAckjYpump";

const connection = new Connection(process.env.SOLANA_RPC_URL || "", {
  commitment: "confirmed",
});

// Validate TOKEN_MINT
let tokenMintPublicKey: PublicKey;
try {
  tokenMintPublicKey = new PublicKey(TOKEN_MINT);
} catch (error) {
  console.error("Invalid TOKEN_MINT:", TOKEN_MINT);
  tokenMintPublicKey = new PublicKey("FTtNADjfMjaT8EYBDXujrLpbGZhjgJNWhYAAckjYpump"); // Fallback
}

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 5000;

function formatAddress(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatTokenAmount(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K`;
  }
  return amount.toLocaleString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (
        error.message?.includes("429") ||
        error.message?.includes("Too Many Requests") ||
        error.message?.includes("rate limit")
      ) {
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
          await sleep(delay);
          continue;
        }
      }

      throw error;
    }
  }

  throw lastError!;
}

async function fetchHoldersFromBlockchain(limit: number = 50) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    await sleep(waitTime);
  }

  lastRequestTime = Date.now();

  return await fetchWithRetry(async () => {
    const tokenAccounts = await connection.getParsedProgramAccounts(
      TOKEN_PROGRAM_ID,
      {
        commitment: "confirmed",
        filters: [
          { dataSize: 165 },
          {
            memcmp: { offset: 0, bytes: tokenMintPublicKey.toBase58() },
          },
        ],
      }
    );

    if (!tokenAccounts || tokenAccounts.length === 0) {
      throw new Error("Nenhum holder encontrado");
    }

    const holdersWithBalance = tokenAccounts
      .map((account) => {
        const parsedData = account.account.data as ParsedAccountData;
        const amount = Number(
          parsedData.parsed?.info?.tokenAmount?.uiAmount || 0
        );
        return {
          account,
          amount,
        };
      })
      .filter((holder) => holder.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    if (holdersWithBalance.length === 0) {
      throw new Error("Nenhum holder com saldo encontrado");
    }

    const totalSupply = holdersWithBalance.reduce(
      (sum, holder) => sum + holder.amount,
      0
    );

    const holders: TokenHolder[] = holdersWithBalance
      .slice(0, limit)
      .map((holder, index) => {
        const percentage = (holder.amount / totalSupply) * 100;
        return {
          address: holder.account.pubkey.toString(),
          shortAddress: formatAddress(holder.account.pubkey.toString()),
          amount: holder.amount,
          percentage: percentage,
          rank: index + 1,
          formattedAmount: formatTokenAmount(holder.amount),
        };
      });

    return {
      holders,
      totalSupply,
      totalHolders: holdersWithBalance.length,
      lastUpdated: new Date().toISOString(),
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 50);
    const data = await fetchHoldersFromBlockchain(limit);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching holders:", error);
    return NextResponse.json([]);
  }
}
