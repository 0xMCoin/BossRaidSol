import { NextRequest, NextResponse } from 'next/server';
import { saveTrade, getTradesForBoss } from '@/lib/db/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bossId = searchParams.get('bossId');
    const limit = parseInt(searchParams.get('limit') || '50');

    if (!bossId) {
      return NextResponse.json({ error: 'bossId is required' }, { status: 400 });
    }

    const trades = getTradesForBoss(parseInt(bossId), limit);
    return NextResponse.json({ trades });
  } catch (error) {
    console.error('Error in trades API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bossId, signature, mint, solAmount, tokenAmount, txType, damageDealt, healApplied, timestamp } = body;

    if (!bossId || !signature || !mint || solAmount === undefined || !tokenAmount || !txType || !timestamp) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const trade = {
      bossId,
      signature,
      mint,
      solAmount,
      tokenAmount,
      txType,
      damageDealt,
      healApplied,
      timestamp
    };

    saveTrade(trade);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving trade:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
