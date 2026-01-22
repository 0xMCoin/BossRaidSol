import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";

// Token Program ID padrão da Solana
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// Função para fazer retry com exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 500
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Verificar se é um erro de rate limit
      const errorMessage = error?.message || String(error || "");
      const isRateLimit = errorMessage.includes("429") || 
                         errorMessage.includes("rate limit") ||
                         errorMessage.includes("Too Many Requests") ||
                         errorMessage.includes("429 Too Many Requests");
      
      if (isRateLimit && attempt < maxRetries - 1) {
        const delayMs = initialDelay * Math.pow(2, attempt);
        console.log(`Rate limit hit, retrying after ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      
      // Se não for rate limit ou já tentou todas as vezes, lançar erro
      throw error;
    }
  }
  
  throw lastError || new Error("Failed after retries");
}

// Função para adicionar delay entre requisições
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Formatar endereço para exibição (primeiros 4 e últimos 4 caracteres)
function formatAddress(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

// Formatar quantidade de tokens
function formatTokenAmount(amount: number, decimals: number = 6): string {
  const formatted = amount / Math.pow(10, decimals);
  if (formatted >= 1000000) {
    return `${(formatted / 1000000).toFixed(2)}M`;
  }
  if (formatted >= 1000) {
    return `${(formatted / 1000).toFixed(2)}K`;
  }
  return formatted.toFixed(2);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const mintAddress = process.env.NEXT_PUBLIC_TOKEN_MINT;

    if (!mintAddress) {
      return NextResponse.json(
        { error: "Mint address is required. Provide it via ?mint= or set NEXT_PUBLIC_TOKEN_MINT" },
        { status: 400 }
      );
    }

    // URL do RPC da Solana (pode ser configurada via variável de ambiente)
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    
    const connection = new Connection(rpcUrl, "confirmed");
    let mintPublicKey: PublicKey;
    
    try {
      mintPublicKey = new PublicKey(mintAddress);
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid mint address format" },
        { status: 400 }
      );
    }

    console.log("Fetching holders for mint:", mintAddress);
    console.log("Using RPC:", rpcUrl);

    // Buscar todos os token accounts para este mint
    let holders: Array<{ address: string; amount: number }> = [];

    try {
      // Verificar se o mint existe
      try {
        const mintInfo = await connection.getParsedAccountInfo(mintPublicKey);
        if (!mintInfo.value) {
          return NextResponse.json(
            { error: "Mint address not found on blockchain" },
            { status: 404 }
          );
        }
        console.log("Mint account found, type:", mintInfo.value.owner.toBase58());
      } catch (error) {
        console.error("Error checking mint:", error);
      }

      // Tentar primeiro com getTokenLargestAccounts (mais eficiente, mas limitado a top 20)
      // Se precisar de mais, usar getProgramAccounts
      const holdersMap = new Map<string, number>();
      
      try {
        // Buscar informações do mint para obter os decimals (com retry)
        let decimals = 9; // Default
        try {
          const mintInfo = await retryWithBackoff(() => 
            connection.getParsedAccountInfo(mintPublicKey)
          );
          if (mintInfo.value && 'parsed' in mintInfo.value.data) {
            decimals = (mintInfo.value.data as any).parsed.info.decimals || 9;
          }
        } catch (error) {
          console.log("Could not fetch mint decimals, using default 9");
        }
        
        
        // Buscar os maiores token accounts (com retry)
        const largestAccounts = await retryWithBackoff(() => 
          connection.getTokenLargestAccounts(mintPublicKey)
        );
        console.log("Largest accounts found:", largestAccounts.value.length);
        
        // Buscar os owners de cada token account (com delay entre requisições)
        for (let i = 0; i < largestAccounts.value.length; i++) {
          const accountInfo = largestAccounts.value[i];
          
          // Adicionar delay entre requisições para evitar rate limit
          if (i > 0) {
            await delay(100); // 100ms entre requisições
          }
          
          if (accountInfo.uiAmount && accountInfo.uiAmount > 0) {
            try {
              const accountInfoFull = await retryWithBackoff(() => 
                connection.getAccountInfo(accountInfo.address)
              );
              if (accountInfoFull && accountInfoFull.data) {
                // Owner está no offset 32-64
                const ownerBytes = accountInfoFull.data.slice(32, 64);
                const owner = new PublicKey(ownerBytes).toBase58();
                const amount = accountInfo.uiAmount * Math.pow(10, decimals); // Converter para raw amount
                
                const currentBalance = holdersMap.get(owner) || 0;
                holdersMap.set(owner, currentBalance + amount);
              }
            } catch (error) {
              console.error("Error fetching account info:", error);
              continue;
            }
          }
        }
      } catch (error) {
        console.log("getTokenLargestAccounts failed:", error);
        // Se falhar por rate limit, retornar erro específico
        if (error instanceof Error && (
          error.message.includes("429") ||
          error.message.includes("rate limit") ||
          error.message.includes("Too Many Requests")
        )) {
          return NextResponse.json(
            {
              error: "Rate limit atingido no RPC. Tente novamente em alguns segundos ou configure um RPC privado via NEXT_PUBLIC_SOLANA_RPC_URL.",
            },
            { status: 429 }
          );
        }
      }

      // Se ainda não temos holders suficientes, não tentar getProgramAccounts
      // pois ele é muito pesado e causa rate limit no RPC público
      if (holdersMap.size < limit && holdersMap.size > 0) {
        console.log(`Found ${holdersMap.size} holders, limit requested: ${limit}. Note: getProgramAccounts is disabled to avoid rate limits.`);
      }

      // Converter para array, ordenar e limitar
      holders = Array.from(holdersMap.entries())
        .map(([address, amount]) => ({
          address,
          amount,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, limit);
    } catch (error) {
      console.error("Error fetching token accounts:", error);
      
      // Se getProgramAccounts falhar por muitos resultados, retornar erro específico
      if (error instanceof Error && (
        error.message.includes("too many") || 
        error.message.includes("429") ||
        error.message.includes("rate limit")
      )) {
        return NextResponse.json(
          {
            error: "Este token tem muitos holders. O RPC atual não consegue buscar todos de uma vez.",
          },
          { status: 500 }
        );
      }
      
      throw error;
    }

    if (holders.length === 0) {
      console.log("No holders found. This could mean:");
      console.log("1. The token has no holders yet");
      console.log("2. The RPC endpoint is limiting results (429 errors)");
      console.log("3. The mint address might be incorrect");
      return NextResponse.json({ 
        holders: [],
        error: "Nenhum holder encontrado. O token pode não ter holders ainda, ou o RPC público está limitando requisições (429). Considere usar um RPC privado configurando NEXT_PUBLIC_SOLANA_RPC_URL."
      });
    }

    // Calcular total para calcular porcentagens
    const totalSupply = holders.reduce((sum, h) => sum + h.amount, 0);

    // Formatar resposta no formato esperado pela UI
    const formattedHolders = holders.map((holder, index) => ({
      address: holder.address,
      shortAddress: formatAddress(holder.address),
      rank: index + 1,
      amount: holder.amount,
      formattedAmount: formatTokenAmount(holder.amount),
      percentage: totalSupply > 0 ? (holder.amount / totalSupply) * 100 : 0,
    }));

    return NextResponse.json({ holders: formattedHolders });
  } catch (error) {
    console.error("Error fetching holders:", error);
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao buscar holders" },
      { status: 500 }
    );
  }
}
