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
    const { action, bossId, currentHealth, isDefeated, signature, txType } =
      body;

    if (action === "updateHealth" && bossId && currentHealth !== undefined) {
      const boss = getBossById(bossId);
      if (!boss) {
        return NextResponse.json({ error: "Boss not found" }, { status: 404 });
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

      updateBossHealth(bossId, currentHealth, isDefeated);
      const bossDefeated = currentHealth <= 0 || isDefeated;

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
