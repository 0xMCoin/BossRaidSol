#!/usr/bin/env tsx
// Script para registrar bosses no Supabase
// Para re-executar: npx tsx register-bosses.ts
// Requer: .env.local com NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY

import { config } from "dotenv";
config({ path: ".env.local" });
config(); // .env como fallback

import { registerBossFromData } from "./src/lib/db/database";

// Bosses configuration - baseado nas imagens normalizadas em public/
// Cada boss precisa de 4 sprites: idle, hitting, healing, dead
const bossesData = [
  {
    id: "quant-kid",
    name: "Quant Kid",
    hpMax: 1000,
    buyWeight: 0.65,
    sellWeight: 0.35,
    buyDmg: 4.5,
    sellHeal: 20,
    twitter: "https://x.com/quantgz",
    sprites: {
      idle: "/b1-quant-kid/quant-kid-idle.png",
      hitting: "/b1-quant-kid/quant-kid-hitting.png",
      healing: "/b1-quant-kid/quant-kid-healing.png",
      dead: "/b1-quant-kid/quant-kid-dead.png"
    }
  },
  {
    id: "cooker-flips",
    name: "Cooker Flips",
    hpMax: 2000,
    buyWeight: 0.6,
    sellWeight: 0.4,
    buyDmg: 6,
    sellHeal: 25,
    twitter: "https://x.com/CookerFlips",
    sprites: {
      idle: "/b2-cooker-flips/cooker-flips-idle.png",
      hitting: "/b2-cooker-flips/cooker-flips-hitting.png",
      healing: "/b2-cooker-flips/cooker-flips-healing.png",
      dead: "/b2-cooker-flips/cooker-flips-dead.png"
    }
  },
  {
    id: "cupsey",
    name: "Cupsey",
    hpMax: 4000,
    buyWeight: 0.58,
    sellWeight: 0.42,
    buyDmg: 8,
    sellHeal: 30,
    twitter: "https://x.com/Cupseyy",
    sprites: {
      idle: "/b3-cupsey/cupsey-idle.png",
      hitting: "/b3-cupsey/cupsey-hitting.png",
      healing: "/b3-cupsey/cupsey-healing.png",
      dead: "/b3-cupsey/cupsey-dead.png"
    }
  },
  {
    id: "orangie",
    name: "Orangie",
    hpMax: 8000,
    buyWeight: 0.55,
    sellWeight: 0.45,
    buyDmg: 10,
    sellHeal: 40,
    twitter: "https://x.com/orangie",
    sprites: {
      idle: "/b4-orangie/orangie-idle.png",
      hitting: "/b4-orangie/orangie-hitting.png",
      healing: "/b4-orangie/orangie-healing.png",
      dead: "/b4-orangie/orangie-dead.png"
    }
  },
  {
    id: "ninety",
    name: "Ninety",
    hpMax: 16000,
    buyWeight: 0.52,
    sellWeight: 0.48,
    buyDmg: 12,
    sellHeal: 45,
    twitter: "https://x.com/98sThoughts",
    sprites: {
      idle: "/b5-ninety/b5-ninety-ghost/ninety-idle.png",
      hitting: "/b5-ninety/b5-ninety-ghost/ninety-hitting.png",
      healing: "/b5-ninety/b5-ninety-ghost/ninety-healing.png",
      dead: "/b5-ninety/b5-ninety-ghost/ninety-dead.png"
    }
  },
  {
    id: "threadguy",
    name: "Threadguy",
    hpMax: 35000,
    buyWeight: 0.5,
    sellWeight: 0.5,
    buyDmg: 15,
    sellHeal: 50,
    twitter: "https://x.com/notthreadguy",
    sprites: {
      idle: "/b6-threadguy/threadguy-idle.png",
      hitting: "/b6-threadguy/threadguy-hitting.png",
      healing: "/b6-threadguy/threadguy-healing.png",
      dead: "/b6-threadguy/threadguy-dead.png"
    }
  },
  {
    id: "frankdegods",
    name: "Frankdegods",
    hpMax: 80000,
    buyWeight: 0.48,
    sellWeight: 0.55,
    buyDmg: 18,
    sellHeal: 60,
    twitter: "https://x.com/frankdegods",
    sprites: {
      idle: "/b7-frankdegods/frankdegods-idle.png",
      hitting: "/b7-frankdegods/frankdegods-hitting.png",
      healing: "/b7-frankdegods/frankdegods-healing.png",
      dead: "/b7-frankdegods/frankdegods-dead.png"
    }
  },
  {
    id: "alon",
    name: "Alon",
    hpMax: 200000,
    buyWeight: 0.47,
    sellWeight: 0.6,
    buyDmg: 20,
    sellHeal: 70,
    twitter: "https://x.com/HsakaTrades",
    sprites: {
      idle: "/b8-alon/alon-idle.png",
      hitting: "/b8-alon/alon-hitting.png",
      healing: "/b8-alon/alon-healing.png",
      dead: "/b8-alon/alon-dead.png"
    }
  },
  {
    id: "hsaka",
    name: "Hsaka",
    hpMax: 350000,
    buyWeight: 0.46,
    sellWeight: 0.65,
    buyDmg: 22,
    sellHeal: 80,
    twitter: "https://x.com/a1lon9",
    sprites: {
      idle: "/b8-hsaka/hsaka-idle.png",
      hitting: "/b8-hsaka/hsaka-hitting.png",
      healing: "/b8-hsaka/hsaka-healing.png",
      dead: "/b8-hsaka/hsaka-dead.png"
    }
  },
  {
    id: "toly-wizard",
    name: "Toly The Wizard",
    hpMax: 500000,
    buyWeight: 0.45,
    sellWeight: 0.7,
    buyDmg: 25,
    sellHeal: 90,
    twitter: "https://x.com/toly",
    sprites: {
      idle: "/b9-toly-wizard/toly-wizard-idle.png",
      hitting: "/b9-toly-wizard/toly-wizard-hitting.png",
      healing: "/b9-toly-wizard/toly-wizard-healing.png",
      dead: "/b9-toly-wizard/toly-wizard-dead.png"
    }
  }
];

async function registerBosses() {
  console.log("Starting boss registration...");

  let successCount = 0;
  let errorCount = 0;

  for (const bossData of bossesData) {
    try {
      const boss = await registerBossFromData(bossData);
      console.log(`[SUCCESS] Registered boss: ${boss.name} (${boss.bossId}) - HP: ${boss.currentHealth}/${boss.maxHealth}`);
      successCount++;
    } catch (error) {
      console.error(`[ERROR] Failed to register boss ${bossData.name}:`, error);
      errorCount++;
    }
  }

  console.log(`\nBoss registration complete!`);
  console.log(`Success: ${successCount}, Errors: ${errorCount}`);
}

registerBosses().catch(console.error);
