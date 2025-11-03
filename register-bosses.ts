#!/usr/bin/env tsx
// Script para registrar bosses no database
// Status: ✅ EXECUTADO - Todos os bosses foram registrados com imagens corretas
// Para re-executar: npx tsx register-bosses.ts

import { registerBossFromData } from "./src/lib/db/database";

const bossesData = [
  {
    "id": "slime",
    "name": "Slime",
    "hpMax": 1000,
    "buyWeight": 0.65,
    "sellWeight": 0.35,
    "buyDmg": 4.5,
    "sellHeal": 20,
    "sprites": {
      "idle": "/images/slimeidle.jpg",
      "hitting": "/images/slimehit.jpg",
      "healing": "/images/slimeheal.jpg",
      "dead": "/images/slimedeath.jpg"
    }
  },
  {
    "id": "spider",
    "name": "Spider",
    "hpMax": 2000,
    "buyWeight": 0.6,
    "sellWeight": 0.4,
    "buyDmg": 6,
    "sellHeal": 25,
    "sprites": {
      "idle": "/images/spideridle.jpg",
      "hitting": "/images/spiderhit.jpg",
      "healing": "/images/spiderheal.jpg",
      "dead": "/images/spiderdeath.jpg"
    }
  },
  {
    "id": "robo",
    "name": "Robo",
    "hpMax": 4000,
    "buyWeight": 0.58,
    "sellWeight": 0.42,
    "buyDmg": 8,
    "sellHeal": 30,
    "sprites": {
      "idle": "/images/roboidle.jpg",
      "hitting": "/images/robohit.jpg",
      "healing": "/images/roboheal.jpg",
      "dead": "/images/robodeath.jpg"
    }
  },
  {
    "id": "golem",
    "name": "Golem",
    "hpMax": 8000,
    "buyWeight": 0.55,
    "sellWeight": 0.45,
    "buyDmg": 10,
    "sellHeal": 40,
    "sprites": {
      "idle": "/images/golemidle.jpg",
      "hitting": "/images/golemhit.jpg",
      "healing": "/images/golemheal.jpg",
      "dead": "/images/golemdeath.jpg"
    }
  },
  {
    "id": "serpent",
    "name": "Serpent",
    "hpMax": 16000,
    "buyWeight": 0.52,
    "sellWeight": 0.48,
    "buyDmg": 12,
    "sellHeal": 45,
    "sprites": {
      "idle": "/images/serpentidle.jpg",
      "hitting": "/images/serpenthit.jpg",
      "healing": "/images/serpentheal.jpg",
      "dead": "/images/serpentdeath.jpg"
    }
  },
  {
    "id": "drag",
    "name": "Dragon",
    "hpMax": 35000,
    "buyWeight": 0.5,
    "sellWeight": 0.5,
    "buyDmg": 15,
    "sellHeal": 50,
    "sprites": {
      "idle": "/images/dragidle.jpg",
      "hitting": "/images/draghit.jpg",
      "healing": "/images/dragheal.jpg",
      "dead": "/images/dragdeath.jpg"
    }
  },
  {
    "id": "chaos",
    "name": "Chaos",
    "hpMax": 80000,
    "buyWeight": 0.48,
    "sellWeight": 0.55,
    "buyDmg": 18,
    "sellHeal": 60,
    "sprites": {
      "idle": "/images/chaosidle.jpg",
      "hitting": "/images/chaoshit.jpg",
      "healing": "/images/chaosheal.jpg",
      "dead": "/images/chaosdeath.jpg"
    }
  },
  {
    "id": "god",
    "name": "God",
    "hpMax": 200000,
    "buyWeight": 0.47,
    "sellWeight": 0.6,
    "buyDmg": 20,
    "sellHeal": 70,
    "sprites": {
      "idle": "/images/godidle.jpg",
      "hitting": "/images/godhit.jpg",
      "healing": "/images/godheal.jpg",
      "dead": "/images/goddeath.jpg"
    }
  },
  {
    "id": "alon",
    "name": "Alon",
    "hpMax": 500000,
    "buyWeight": 0.46,
    "sellWeight": 0.65,
    "buyDmg": 22,
    "sellHeal": 80,
    "sprites": {
      "idle": "/images/alonidle.jpg",
      "hitting": "/images/alonhit.jpg",
      "healing": "/images/alonheal.jpg",
      "dead": "/images/alondeath.jpg"
    }
  }
];

async function registerBosses() {
  console.log("🚀 Starting boss registration...");

  for (const bossData of bossesData) {
    try {
      const boss = registerBossFromData(bossData);
      console.log(`✅ Registered boss: ${boss.name} (${boss.bossId}) - HP: ${boss.currentHealth}/${boss.maxHealth}`);
    } catch (error) {
      console.error(`❌ Failed to register boss ${bossData.name}:`, error);
    }
  }

  console.log("🎉 Boss registration complete!");
}

registerBosses().catch(console.error);
