import { NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { supabase } from "@/lib/supabase/server";

// Endpoint para popular trader_address de uma trade específica
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const signature = searchParams.get("signature");

    if (!signature) {
      return NextResponse.json({ error: "signature is required" }, { status: 400 });
    }

    // Verificar se já tem trader_address
    const { data: existing } = await supabase
      .from("trades")
      .select("trader_address")
      .eq("signature", signature)
      .single();

    if (existing?.trader_address) {
      return NextResponse.json({ success: true, message: "Already has trader_address" });
    }

    // Buscar da blockchain
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
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
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, traderAddress });
    }

    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  } catch (error) {
    console.error("Error populating trader address:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
