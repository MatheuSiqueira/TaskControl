import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS contratos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,
  fornecedor TEXT NOT NULL,
  objeto TEXT NOT NULL DEFAULT '',
  data_inicio TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  valor_inicial INTEGER NOT NULL,
  observacoes TEXT NOT NULL DEFAULT '',
  arquivado INTEGER NOT NULL DEFAULT 0,
  versao INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  atualizado_por TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS aditivos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL DEFAULT '',
  valor_delta INTEGER NOT NULL DEFAULT 0,
  nova_data_fim TEXT,
  criado_em TEXT NOT NULL,
  criado_por TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  data_emissao TEXT,
  data_entrada TEXT NOT NULL,
  valor INTEGER NOT NULL,
  observacao TEXT NOT NULL DEFAULT '',
  versao INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  criado_por TEXT NOT NULL DEFAULT '',
  UNIQUE (contrato_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_notas_contrato ON notas(contrato_id);
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quando TEXT NOT NULL,
  usuario TEXT NOT NULL,
  acao TEXT NOT NULL,
  contrato_id INTEGER,
  detalhe TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_aud_contrato ON auditoria(contrato_id);
`;

export function abrirBanco(arquivo) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  // WAL: leitores não bloqueiam o escritor; busy_timeout: escritas simultâneas esperam em vez de falhar.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function transacao(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
