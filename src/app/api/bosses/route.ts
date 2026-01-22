import { NextRequest, NextResponse } from "next/server";
import {
  getAllBosses,
  getCurrentBoss,
  updateBossHealth,
  getBossById,
} from "@/lib/db/database";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    if (action === "current") {
      const boss = await getCurrentBoss();
      return NextResponse.json({ boss });
    }

    if (action === "all") {
      const bosses = await getAllBosses();
      return NextResponse.json({ bosses });
    }

    const id = searchParams.get("id");
    if (id) {
      const boss = await getBossById(parseInt(id));
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
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }
    
    const { action, bossId, currentHealth, isDefeated, signature, txType } =
      body;

    if (action === "updateHealth" && bossId && currentHealth !== undefined) {
      const boss = await getBossById(bossId);
      if (!boss) {
        return NextResponse.json({ error: "Boss not found" }, { status: 404 });
      }

      // Não permitir curar um boss que já está derrotado
      if (boss.isDefeated && currentHealth > boss.currentHealth && txType === "sell") {
        return NextResponse.json(
          { error: "Boss já está derrotado e não pode ser curado" },
          { status: 400 }
        );
      }

      const isHealthIncrease = currentHealth > boss.currentHealth;
      const isHealthDecrease = currentHealth < boss.currentHealth;

      if (isHealthIncrease && txType !== "sell") {
        console.warn("Health increase validation failed but allowing:", {
          txType,
          isHealthIncrease,
        });
      }

      if (isHealthDecrease && txType !== "buy") {
        console.warn("Health decrease validation failed but allowing:", {
          txType,
          isHealthDecrease,
        });
      }

      if (!signature) {
        return NextResponse.json(
          { error: "Trade signature required" },
          { status: 400 }
        );
      }

      // Garantir que se a vida chegou a 0, o boss seja marcado como derrotado
      const shouldBeDefeated = currentHealth <= 0 || isDefeated;
      await updateBossHealth(bossId, currentHealth, shouldBeDefeated);
      const bossDefeated = shouldBeDefeated;

      return NextResponse.json({ success: true, bossDefeated });
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
