-- Adicionar coluna twitter na tabela bosses
ALTER TABLE bosses ADD COLUMN IF NOT EXISTS twitter TEXT;
