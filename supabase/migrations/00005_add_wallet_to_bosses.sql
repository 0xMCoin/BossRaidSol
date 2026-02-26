-- Adicionar coluna wallet na tabela bosses
ALTER TABLE bosses ADD COLUMN IF NOT EXISTS wallet TEXT;
