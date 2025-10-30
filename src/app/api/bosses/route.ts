import { NextRequest, NextResponse } from 'next/server';
import { getAllBosses, getCurrentBoss, updateBossHealth, getBossById } from '@/lib/db/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'current') {
      console.log("📡 API: Getting current boss...");
      const boss = getCurrentBoss();
      console.log("📡 API: Current boss result:", boss);
      return NextResponse.json({ boss });
    }

    if (action === 'all') {
      const bosses = getAllBosses();
      return NextResponse.json({ bosses });
    }

    const id = searchParams.get('id');
    if (id) {
      const boss = getBossById(parseInt(id));
      return NextResponse.json({ boss });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error in bosses API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {

    const body = await request.json();
    const { action, bossId, currentHealth, isDefeated, signature } = body;

    if (action === 'updateHealth' && bossId && currentHealth !== undefined) {
      // Security: Validate health change logic
      const boss = getBossById(bossId);
      if (!boss) {
        return NextResponse.json({ error: 'Boss not found' }, { status: 404 });
      }

      // Only allow health reduction (damage) from WebSocket trades
      // Health increases (healing) should only come from verified sell trades
      if (currentHealth > boss.currentHealth) {
        return NextResponse.json({ error: 'Invalid health increase' }, { status: 400 });
      }

      // Require signature for health updates (trade verification)
      if (!signature) {
        return NextResponse.json({ error: 'Trade signature required' }, { status: 400 });
      }

      updateBossHealth(bossId, currentHealth, isDefeated);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action or parameters' }, { status: 400 });
  } catch (error) {
    console.error('Error in bosses POST API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
