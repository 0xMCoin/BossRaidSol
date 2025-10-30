import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateGameSession, updateGameSession, getGameStats, resetGame } from '@/lib/db/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'session') {
      const session = getOrCreateGameSession();
      return NextResponse.json({ session });
    }

    if (action === 'stats') {
      const stats = getGameStats();
      return NextResponse.json({ stats });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error in game API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, sessionId, damageDealt, healApplied, newBossId } = body;

    if (action === 'updateSession' && sessionId) {
      updateGameSession(sessionId, damageDealt || 0, healApplied || 0, newBossId);
      return NextResponse.json({ success: true });
    }

    if (action === 'reset') {
      resetGame();
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action or parameters' }, { status: 400 });
  } catch (error) {
    console.error('Error in game POST API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
