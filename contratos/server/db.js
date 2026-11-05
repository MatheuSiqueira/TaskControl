import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS contratos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto TEXT NOT NULL,
  codigo TEXT NOT NULL DEFAULT '',
  numero TEXT NOT NULL,
  fornecedor TEXT NOT NULL,
  unidade TEXT NOT NULL,
  qtd_contratada INTEGER NOT NULL,         -- milésimos
  data_inicio TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  aquisicao TEXT NOT NULL DEFAULT '',      -- 'Pregão' | 'PV' | ''
  requisicao TEXT NOT NULL DEFAULT '',
  entrega_unica INTEGER NOT NULL DEFAULT 0,
  qtd_locacao INTEGER,                     -- milésimos; NULL = sem locação
  planejador TEXT NOT NULL DEFAULT '',
  valor_unit_produto INTEGER,              -- centavos
  valor_unit_locacao INTEGER,
  emails TEXT NOT NULL DEFAULT '',
  importancia TEXT NOT NULL DEFAULT '',
  novo_processo TEXT NOT NULL DEFAULT '',
  np_valor INTEGER, np_qtd INTEGER, np_prazo TEXT NOT NULL DEFAULT '', np_inicio TEXT, np_termino TEXT,
  observacoes TEXT NOT NULL DEFAULT '',
  arquivado INTEGER NOT NULL DEFAULT 0,
  versao INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  atualizado_por TEXT NOT NULL DEFAULT '',
  UNIQUE (produto, numero)
);
CREATE TABLE IF NOT EXISTS movimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  data TEXT NOT NULL,
  nf TEXT NOT NULL DEFAULT '',
  quantidade INTEGER NOT NULL,             -- milésimos
  observacao TEXT NOT NULL DEFAULT '',
  versao INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  criado_por TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_mov_contrato ON movimentos(contrato_id);
CREATE TABLE IF NOT EXISTS solicitacoes (   -- um registro por item; itens da mesma emissão compartilham o lote
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lote INTEGER NOT NULL,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  modalidade TEXT NOT NULL,
  quantidade INTEGER NOT NULL,             -- milésimos
  observacao TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aberta',   -- aberta | atendida | cancelada
  criado_em TEXT NOT NULL,
  criado_por TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sol_contrato ON solicitacoes(contrato_id);
CREATE INDEX IF NOT EXISTS idx_sol_lote ON solicitacoes(lote);
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
  // Protótipo anterior (contratos em R$) nunca foi usado em produção: troca de esquema sem migração.
  const velho = db.prepare("SELECT 1 FROM pragma_table_info('contratos') WHERE name = 'valor_inicial'").get();
  if (velho) db.exec('DROP TABLE IF EXISTS aditivos; DROP TABLE IF EXISTS notas; DROP TABLE IF EXISTS contratos; DROP TABLE IF EXISTS auditoria;');
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
