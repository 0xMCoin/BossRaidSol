#!/usr/bin/env tsx
// Script para normalizar nomes de pastas e arquivos dos bosses
// Remove espaços e padroniza os nomes

import * as fs from "fs";
import * as path from "path";

const publicDir = path.join(process.cwd(), "public");

// Mapeamento de pastas antigas para novas (normalizadas)
const folderMappings: Array<{ old: string; new: string; bossId: string }> = [
  { old: "B1 - QUANT KID", new: "b1-quant-kid", bossId: "quant-kid" },
  { old: "B2 - COOKER FLIPS", new: "b2-cooker-flips", bossId: "cooker-flips" },
  { old: "B3 - CUPSEY", new: "b3-cupsey", bossId: "cupsey" },
  { old: "B4 - ORANGIE", new: "b4-orangie", bossId: "orangie" },
  { old: "B5 - NINETY", new: "b5-ninety", bossId: "ninety" },
  { old: "B6 - THREADGUY", new: "b6-threadguy", bossId: "threadguy" },
  { old: "B7 - FRANKDEGODS", new: "b7-frankdegods", bossId: "frankdegods" },
  { old: "B8 - ALON", new: "b8-alon", bossId: "alon" },
  { old: "B8 - HSAKA", new: "b8-hsaka", bossId: "hsaka" },
  { old: "B9 - TOLY THE WIZARD", new: "b9-toly-wizard", bossId: "toly-wizard" }
];

// Função para normalizar nome de arquivo
function normalizeFileName(fileName: string, bossId: string): string {
  // Remove espaços, converte para lowercase, substitui espaços por hífens
  let normalized = fileName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-.]/g, "")
    .replace(/-+/g, "-");

  // Padroniza os nomes dos sprites
  normalized = normalized
    .replace(/base\.png$/, "idle.png")
    .replace(/hit\.png$/, "hitting.png")
    .replace(/heal(ing)?\.png$/, "healing.png")
    .replace(/(dead|defeated)\.png$/, "dead.png");

  // Se o arquivo não começa com o bossId, adiciona
  if (!normalized.startsWith(bossId)) {
    normalized = `${bossId}-${normalized}`;
  }

  return normalized;
}

async function normalizeBossFiles() {
  console.log("Starting normalization of boss folders and files...\n");

  for (const mapping of folderMappings) {
    const oldFolderPath = path.join(publicDir, mapping.old);
    const newFolderPath = path.join(publicDir, mapping.new);

    if (!fs.existsSync(oldFolderPath)) {
      console.log(`[SKIP] Folder not found: ${mapping.old}`);
      continue;
    }

    try {
      // Renomear pasta principal
      if (fs.existsSync(newFolderPath)) {
        console.log(`[SKIP] Folder already exists: ${mapping.new}`);
      } else {
        fs.renameSync(oldFolderPath, newFolderPath);
        console.log(`[RENAMED] ${mapping.old} -> ${mapping.new}`);
      }

      // Processar arquivos dentro da pasta
      const files = fs.readdirSync(newFolderPath, { withFileTypes: true });

      for (const file of files) {
        if (file.isDirectory()) {
          // Processar subpastas (como B5 - NINETY GHOST)
          const oldSubPath = path.join(newFolderPath, file.name);
          const normalizedSubName = file.name
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "");
          const newSubPath = path.join(newFolderPath, normalizedSubName);

          if (oldSubPath !== newSubPath && !fs.existsSync(newSubPath)) {
            fs.renameSync(oldSubPath, newSubPath);
            console.log(`  [RENAMED SUB] ${file.name} -> ${normalizedSubName}`);

            // Renomear arquivos dentro da subpasta
            const subFiles = fs.readdirSync(newSubPath);
            for (const subFile of subFiles) {
              const oldSubFilePath = path.join(newSubPath, subFile);
              const newSubFileName = normalizeFileName(subFile, mapping.bossId);
              const newSubFilePath = path.join(newSubPath, newSubFileName);

              if (oldSubFilePath !== newSubFilePath && !fs.existsSync(newSubFilePath)) {
                fs.renameSync(oldSubFilePath, newSubFilePath);
                console.log(`    [RENAMED FILE] ${subFile} -> ${newSubFileName}`);
              }
            }
          }
        } else if (file.isFile() && file.name.endsWith(".png")) {
          // Renomear arquivos PNG
          const oldFilePath = path.join(newFolderPath, file.name);
          const newFileName = normalizeFileName(file.name, mapping.bossId);
          const newFilePath = path.join(newFolderPath, newFileName);

          if (oldFilePath !== newFilePath && !fs.existsSync(newFilePath)) {
            fs.renameSync(oldFilePath, newFilePath);
            console.log(`  [RENAMED FILE] ${file.name} -> ${newFileName}`);
          }
        }
      }
    } catch (error) {
      console.error(`[ERROR] Failed to process ${mapping.old}:`, error);
    }
  }

  console.log("\nNormalization complete!");
}

normalizeBossFiles().catch(console.error);
