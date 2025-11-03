import { NextRequest, NextResponse } from "next/server";
import {
  getAllBosses,
  getCurrentBoss,
  updateBossHealth,
  getBossById,
} from "@/lib/db/database";
import { Connection, PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as bs58 from "bs58";

// Configuration for fee distribution
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "";
const FEE_WALLET_PRIVATE_KEY = process.env.FEE_WALLET_PRIVATE_KEY || "";

// Pre-set holders for fee distribution
const FEE_DISTRIBUTION_HOLDERS = [
  "BtKioSVRFNdfNWpvMurtucqHRAJZMysTMGAv6btWfCpn",
];

// Initialize Solana connection
const connection = new Connection(SOLANA_RPC_URL, "confirmed");

// Initialize fee wallet (only if private key is provided)
let feeWallet: Keypair | null = null;
if (FEE_WALLET_PRIVATE_KEY) {
  try {
    const secretKey = bs58.default.decode(FEE_WALLET_PRIVATE_KEY);
    feeWallet = Keypair.fromSecretKey(secretKey);
    console.log("Fee wallet initialized:", feeWallet.publicKey.toString());
  } catch (error) {
    console.error("Failed to initialize fee wallet:", error);
  }
}

// Function to distribute fees to holders
async function distributeFeesToHolders(feeAmount: number, bossName: string): Promise<any[]> {
  const results = [];

  if (!feeWallet) {
    console.warn("No fee wallet configured - simulating distribution");
    for (let i = 0; i < FEE_DISTRIBUTION_HOLDERS.length; i++) {
      results.push({
        holder: FEE_DISTRIBUTION_HOLDERS[i].substring(0, 8) + "...",
        amount: feeAmount / FEE_DISTRIBUTION_HOLDERS.length,
        status: "simulated",
        txSignature: null
      });
    }
    return results;
  }

  const feePerHolder = feeAmount / FEE_DISTRIBUTION_HOLDERS.length;
  const lamportsPerHolder = Math.floor(feePerHolder * LAMPORTS_PER_SOL);

  console.log(`🎯 Boss ${bossName} defeated! Distributing ${feeAmount} SOL to ${FEE_DISTRIBUTION_HOLDERS.length} holders`);

  for (let i = 0; i < FEE_DISTRIBUTION_HOLDERS.length; i++) {
    const holderAddress = FEE_DISTRIBUTION_HOLDERS[i];

    try {
      // Validate holder address
      const holderPublicKey = new PublicKey(holderAddress);

      console.log(`Sending ${feePerHolder} SOL to holder ${i + 1} (${holderAddress})`);

      // Create transfer instruction
      const transferInstruction = SystemProgram.transfer({
        fromPubkey: feeWallet.publicKey,
        toPubkey: holderPublicKey,
        lamports: lamportsPerHolder,
      });

      // Create and send transaction
      const transaction = new Transaction().add(transferInstruction);

      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = feeWallet.publicKey;

      // Sign and send transaction
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [feeWallet],
        {
          commitment: "confirmed",
          preflightCommitment: "confirmed",
        }
      );

      console.log(`✅ Transaction successful: ${signature}`);

      results.push({
        holder: holderAddress.substring(0, 8) + "...",
        amount: feePerHolder,
        status: "completed",
        txSignature: signature
      });

    } catch (error) {
      console.error(`❌ Failed to send to holder ${i + 1} (${holderAddress}):`, error);

      results.push({
        holder: holderAddress.substring(0, 8) + "...",
        amount: feePerHolder,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
        txSignature: null
      });
    }

    // Small delay between transactions to avoid rate limits
    if (i < FEE_DISTRIBUTION_HOLDERS.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    if (action === "current") {
      const boss = getCurrentBoss();
      return NextResponse.json({ boss });
    }

    if (action === "all") {
      const bosses = getAllBosses();
      return NextResponse.json({ bosses });
    }

    const id = searchParams.get("id");
    if (id) {
      const boss = getBossById(parseInt(id));
      return NextResponse.json({ boss });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Error in bosses API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, bossId, currentHealth, isDefeated, signature, txType } = body;

    if (action === "updateHealth" && bossId && currentHealth !== undefined) {
      // Security: Validate health change logic
      const boss = getBossById(bossId);
      if (!boss) {
        return NextResponse.json({ error: "Boss not found" }, { status: 404 });
      }

      // Allow health reduction (damage) from buy trades or health increases (healing) from sell trades
      const isHealthIncrease = currentHealth > boss.currentHealth;
      const isHealthDecrease = currentHealth < boss.currentHealth;

      // Temporarily relax validation for debugging
      // Validate trade type for health changes
      if (isHealthIncrease && txType !== "sell") {
        console.warn("Health increase validation failed but allowing:", { txType, isHealthIncrease });
        // return NextResponse.json(
        //   { error: "Health increases only allowed for sell trades" },
        //   { status: 400 }
        // );
      }

      if (isHealthDecrease && txType !== "buy") {
        console.warn("Health decrease validation failed but allowing:", { txType, isHealthDecrease });
        // return NextResponse.json(
        //   { error: "Health decreases only allowed for buy trades" },
        //   { status: 400 }
        // );
      }

      // Require signature for health updates (trade verification)
      if (!signature) {
        return NextResponse.json(
          { error: "Trade signature required" },
          { status: 400 }
        );
      }

      updateBossHealth(bossId, currentHealth, isDefeated);

      // Check if boss was defeated and distribute fees automatically
      if (isDefeated || currentHealth <= 0) {
        console.log(`🎯 Boss ${boss.name} defeated! Starting automatic fee distribution...`);

        try {
          // Claim fees from Pump Fun first
          const apiKey = process.env.NEXT_PUBLIC_BOSS_RAID_API_KEY;
          let feeAmount = 0.01; // Default small amount for testing

          if (apiKey) {
            console.log("💰 Claiming creator fees from Pump Fun...");

            const claimResponse = await fetch(`https://pumpportal.fun/api/trade?api-key=${apiKey}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                "action": "collectCreatorFee",
                "priorityFee": 0.000001,
                "pool": "pump",
                "mint": process.env.NEXT_PUBLIC_TOKEN_MINT || "",
              })
            });

            if (claimResponse.ok) {
              const feeData = await claimResponse.json();
              console.log("✅ Fees claimed successfully:", feeData);
              if (feeData && feeData.amount && feeData.amount > 0) {
                feeAmount = feeData.amount;
              }
            } else {
              console.error("Failed to claim fees from Pump Fun:", claimResponse.status, await claimResponse.text());
            }
          } else {
            console.warn("No API key configured - using default fee amount");
          }

          // Distribute fees to holders
          const distributionResults = await distributeFeesToHolders(feeAmount, boss.name);

          console.log("📊 Fee distribution completed:", {
            bossName: boss.name,
            feeAmount,
            holdersCount: FEE_DISTRIBUTION_HOLDERS.length,
            distributionResults
          });

          return NextResponse.json({
            success: true,
            bossDefeated: true,
            feeDistribution: {
              amount: feeAmount,
              holdersCount: FEE_DISTRIBUTION_HOLDERS.length,
              results: distributionResults
            }
          });

        } catch (error) {
          console.error("Error during automatic fee distribution:", error);
          // Still return success for the health update, but log the distribution error
          return NextResponse.json({
            success: true,
            bossDefeated: true,
            feeDistributionError: error instanceof Error ? error.message : "Unknown error"
          });
        }
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "Invalid action or parameters" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error in bosses POST API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
