import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/server";

// Formatar endereço para exibição
function formatAddress(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bossId = searchParams.get("bossId");
    const limit = parseInt(searchParams.get("limit") || "50");

    if (!bossId) {
      return NextResponse.json(
        { error: "bossId is required" },
        { status: 400 }
      );
    }

    // Usar SQL direto para calcular o ranking - MUITO MAIS RÁPIDO
    // Primeiro tentar com trader_address, depois fallback para signature
    let data: any[] | null = null;
    let error: any = null;

    // Tentar usar a função RPC primeiro (mais rápido)
    const rpcResult = await supabase.rpc('get_top_damage_dealers', {
      p_boss_id: parseInt(bossId),
      p_limit: limit
    });

    if (rpcResult.error) {
      console.log("RPC function error, using fallback:", rpcResult.error);
      
      // Se a função RPC não existir ou der erro, usar query SQL direta
      // Primeiro tentar com trader_address
      const { data: sqlData, error: sqlError } = await supabase
        .from("trades")
        .select("trader_address, damage_dealt, heal_applied, tx_type, signature")
        .eq("boss_id", parseInt(bossId));

      if (sqlError) {
        error = sqlError;
        console.error("SQL query error:", sqlError);
      } else {
        console.log(`Found ${sqlData?.length || 0} trades for boss ${bossId}`);
        
        // Agrupar por trader_address (ou signature como fallback)
        const dealersMap = new Map<string, {
          totalDamage: number;
          totalHeal: number;
          buyCount: number;
          sellCount: number;
        }>();

        for (const trade of sqlData || []) {
          // Usar trader_address se disponível, senão usar signature como fallback temporário
          const trader = (trade.trader_address as string) || `sig_${trade.signature}`;
          const damage = Number(trade.damage_dealt || 0);
          const heal = Number(trade.heal_applied || 0);
          const txType = trade.tx_type as string;

          const existing = dealersMap.get(trader) || {
            totalDamage: 0,
            totalHeal: 0,
            buyCount: 0,
            sellCount: 0,
          };

          existing.totalDamage += damage;
          existing.totalHeal += heal;
          if (txType === "buy") existing.buyCount++;
          if (txType === "sell") existing.sellCount++;

          dealersMap.set(trader, existing);
        }

        console.log(`Grouped into ${dealersMap.size} dealers`);

        // Converter para array e calcular dano líquido
        data = Array.from(dealersMap.entries()).map(([address, data]) => ({
          address: address.startsWith('sig_') ? null : address, // Não mostrar signature como address
          total_damage: data.totalDamage,
          total_heal: data.totalHeal,
          net_damage: data.totalDamage - data.totalHeal,
          buy_count: data.buyCount,
          sell_count: data.sellCount,
        })).filter(d => d.net_damage > 0 && d.address) // Apenas quem tem address e dano líquido positivo
          .sort((a, b) => b.net_damage - a.net_damage)
          .slice(0, limit);
        
        console.log(`Final dealers count: ${data.length}`);
      }
    } else {
      data = rpcResult.data;
      console.log(`RPC function returned ${data?.length || 0} dealers`);
    }

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      console.log("No dealers found. Checking for trades...");
      
      // Verificar se há trades (para debug)
      const { data: tradesCheck, count } = await supabase
        .from("trades")
        .select("signature, trader_address, damage_dealt, heal_applied", { count: 'exact' })
        .eq("boss_id", parseInt(bossId))
        .limit(10);
      
      console.log(`Total trades for boss ${bossId}: ${count || 0}`);
      if (tradesCheck && tradesCheck.length > 0) {
        const withAddress = tradesCheck.filter((t: any) => t.trader_address);
        const withoutAddress = tradesCheck.filter((t: any) => !t.trader_address);
        console.log(`Sample: ${withAddress.length} with address, ${withoutAddress.length} without`);
        console.log(`Sample trades:`, tradesCheck.slice(0, 3));
      }
      
      return NextResponse.json({ dealers: [] });
    }

    // Formatar resposta
    const formattedDealers = data.map((dealer: any, index: number) => ({
      address: dealer.address || dealer.trader_address,
      shortAddress: formatAddress(dealer.address || dealer.trader_address),
      rank: index + 1,
      totalDamage: dealer.total_damage || dealer.totalDamage || 0,
      totalHeal: dealer.total_heal || dealer.totalHeal || 0,
      netDamage: dealer.net_damage || dealer.netDamage || 0,
      formattedNetDamage: formatDamage(dealer.net_damage || dealer.netDamage || 0),
      buyCount: dealer.buy_count || dealer.buyCount || 0,
      sellCount: dealer.sell_count || dealer.sellCount || 0,
    }));

    return NextResponse.json({ dealers: formattedDealers });
  } catch (error) {
    console.error("Error fetching top damage dealers:", error);
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao buscar ranking de dano" },
      { status: 500 }
    );
  }
}
