import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco, transacao } from './db.js';
import { metricas, hojeISO, dataValida } from './calc.js';

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui');

class ErroHttp extends Error {
  constructor(status, msg, extra = {}) { super(msg); this.status = status; this.extra = extra; }
}
const centavos = (reais) => Math.round(Number(reais) * 100);
const reais = (c) => c / 100;

function texto(v, nome, { obrigatorio = false, max = 500 } = {}) {
  const s = (v ?? '').toString().trim();
  if (obrigatorio && !s) throw new ErroHttp(400, `${nome} é obrigatório`);
  if (s.length > max) throw new ErroHttp(400, `${nome} muito longo (máx. ${max})`);
  return s;
}
function data(v, nome, { obrigatorio = true } = {}) {
  if ((v === undefined || v === null || v === '') && !obrigatorio) return null;
  if (!dataValida(v)) throw new ErroHttp(400, `${nome} inválida (use AAAA-MM-DD)`);
  return v;
}
function valor(v, nome, { permitirNegativo = false } = {}) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n)) throw new ErroHttp(400, `${nome} inválido`);
  const c = centavos(n);
  if (!permitirNegativo && c <= 0) throw new ErroHttp(400, `${nome} deve ser maior que zero`);
  if (Math.abs(c) > 1e13) throw new ErroHttp(400, `${nome} fora do limite`);
  return c;
}

export function criarApp({ dbPath, codigoAcesso = '', hoje = hojeISO } = {}) {
  const db = abrirBanco(dbPath);
  const app = express();
  app.use(express.json({ limit: '200kb' }));

  // ---- tempo real: cada alteração avisa os outros computadores abertos -----------------
  const ouvintes = new Set();
  const avisar = (evento) => {
    const msg = `data: ${JSON.stringify(evento)}\n\n`;
    for (const res of ouvintes) res.write(msg);
  };
  setInterval(() => { for (const r of ouvintes) r.write(': ping\n\n'); }, 25_000).unref();

  // ---- acesso ----------------------------------------------------------------------------
  app.get('/api/saude', (_req, res) => res.json({ ok: true, exigeCodigo: Boolean(codigoAcesso) }));
  app.use('/api', (req, _res, next) => {
    if (!codigoAcesso || req.path === '/saude') return next();
    const enviado = req.get('x-codigo') || req.query.codigo;
    if (enviado !== codigoAcesso) return next(new ErroHttp(401, 'Código de acesso inválido'));
    next();
  });
  const usuarioDe = (req) => texto(req.get('x-usuario') ? decodeURIComponent(req.get('x-usuario')) : '', 'Usuário', { max: 60 }) || 'anônimo';

  const agora = () => new Date().toISOString();
  const auditar = (usuario, acao, contratoId, detalhe = '') =>
    db.prepare('INSERT INTO auditoria (quando, usuario, acao, contrato_id, detalhe) VALUES (?,?,?,?,?)')
      .run(agora(), usuario, acao, contratoId, detalhe);

  // ---- leitura ---------------------------------------------------------------------------
  const contratoOu404 = (id) => {
    const c = db.prepare('SELECT * FROM contratos WHERE id = ?').get(id);
    if (!c) throw new ErroHttp(404, 'Contrato não encontrado');
    return c;
  };
  const aditivosDe = (id) => db.prepare('SELECT * FROM aditivos WHERE contrato_id = ? ORDER BY id').all(id);
  const notasDe = (id) => db.prepare('SELECT * FROM notas WHERE contrato_id = ? ORDER BY data_entrada DESC, id DESC').all(id);

  const monetario = ['total', 'consumido', 'saldo', 'consumoMedioMensal', 'necessarioMensal', 'sobraNoFim'];
  function visaoContrato(c, aditivos, notas) {
    const m = metricas(c, aditivos, notas, hoje());
    for (const k of monetario) if (m[k] !== null) m[k] = reais(m[k]);
    return {
      id: c.id, numero: c.numero, fornecedor: c.fornecedor, objeto: c.objeto,
      data_inicio: c.data_inicio, data_fim_original: c.data_fim,
      valor_inicial: reais(c.valor_inicial), observacoes: c.observacoes,
      arquivado: Boolean(c.arquivado), versao: c.versao,
      atualizado_em: c.atualizado_em, atualizado_por: c.atualizado_por,
      ...m,
    };
  }
  const nota = (n) => ({ ...n, valor: reais(n.valor) });
  const aditivo = (a) => ({ ...a, valor_delta: reais(a.valor_delta) });

  const todosVisao = (incluirArquivados = false) =>
    db.prepare(`SELECT * FROM contratos ${incluirArquivados ? '' : 'WHERE arquivado = 0'} ORDER BY numero`).all()
      .map((c) => visaoContrato(c, aditivosDe(c.id), notasDe(c.id)));

  app.get('/api/dashboard', (_req, res) => {
    const contratos = todosVisao();
    const vigentes = contratos.filter((c) => !c.vencido);
    const soma = (arr, k) => Math.round(arr.reduce((s, c) => s + c[k], 0) * 100) / 100;
    const ordem = { critico: 0, atencao: 1, ok: 2, futuro: 3 };
    contratos.sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || a.diasRestantes - b.diasRestantes);
    const recentes = db.prepare(`
      SELECT n.*, c.numero AS contrato_numero, c.fornecedor FROM notas n
      JOIN contratos c ON c.id = n.contrato_id WHERE c.arquivado = 0
      ORDER BY n.data_entrada DESC, n.id DESC LIMIT 8`).all().map(nota);
    res.json({
      hoje: hoje(),
      resumo: {
        contratos: contratos.length,
        vigentes: vigentes.length,
        saldoVigente: soma(vigentes, 'saldo'),
        totalVigente: soma(vigentes, 'total'),
        consumidoVigente: soma(vigentes, 'consumido'),
        emCritico: contratos.filter((c) => c.situacao === 'critico').length,
        emAtencao: contratos.filter((c) => c.situacao === 'atencao').length,
        vencendo90: vigentes.filter((c) => c.iniciado && c.diasRestantes <= 90).length,
      },
      contratos,
      recentes,
    });
  });

  app.get('/api/contratos', (req, res) => res.json(todosVisao(req.query.arquivados === '1')));

  app.get('/api/contratos/:id', (req, res) => {
    const c = contratoOu404(req.params.id);
    const aditivos = aditivosDe(c.id);
    const notas = notasDe(c.id);
    const historico = db.prepare('SELECT * FROM auditoria WHERE contrato_id = ? ORDER BY id DESC LIMIT 100').all(c.id);
    res.json({
      ...visaoContrato(c, aditivos, notas),
      aditivos: aditivos.map(aditivo),
      notas: notas.map(nota),
      historico,
    });
  });

  // ---- contratos ------------------------------------------------------------------------
  function lerContrato(b) {
    const out = {
      numero: texto(b.numero, 'Número', { obrigatorio: true, max: 60 }),
      fornecedor: texto(b.fornecedor, 'Fornecedor', { obrigatorio: true, max: 160 }),
      objeto: texto(b.objeto, 'Objeto', { max: 1000 }),
      data_inicio: data(b.data_inicio, 'Início da vigência'),
      data_fim: data(b.data_fim, 'Fim da vigência'),
      valor_inicial: valor(b.valor_inicial, 'Valor do contrato'),
      observacoes: texto(b.observacoes, 'Observações', { max: 2000 }),
    };
    if (out.data_fim <= out.data_inicio) throw new ErroHttp(400, 'O fim da vigência deve ser depois do início');
    return out;
  }
  const emUso = (e) => e instanceof Error && /UNIQUE/.test(e.message);

  app.post('/api/contratos', (req, res) => {
    const u = usuarioDe(req);
    const c = lerContrato(req.body);
    try {
      const id = transacao(db, () => {
        const r = db.prepare(`INSERT INTO contratos (numero, fornecedor, objeto, data_inicio, data_fim, valor_inicial, observacoes, criado_em, atualizado_em, atualizado_por)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(c.numero, c.fornecedor, c.objeto, c.data_inicio, c.data_fim, c.valor_inicial, c.observacoes, agora(), agora(), u);
        auditar(u, 'contrato criado', r.lastInsertRowid, `${c.numero} · ${c.fornecedor}`);
        return Number(r.lastInsertRowid);
      });
      avisar({ tipo: 'contrato', id, usuario: u });
      res.status(201).json(visaoContrato(contratoOu404(id), [], []));
    } catch (e) {
      if (emUso(e)) throw new ErroHttp(409, `Já existe um contrato com o número ${c.numero}`);
      throw e;
    }
  });

  app.put('/api/contratos/:id', (req, res) => {
    const u = usuarioDe(req);
    const atual = contratoOu404(req.params.id);
    const c = lerContrato(req.body);
    const arquivado = req.body.arquivado === undefined ? atual.arquivado : req.body.arquivado ? 1 : 0;
    try {
      const r = db.prepare(`UPDATE contratos SET numero=?, fornecedor=?, objeto=?, data_inicio=?, data_fim=?, valor_inicial=?, observacoes=?,
          arquivado=?, versao=versao+1, atualizado_em=?, atualizado_por=? WHERE id=? AND versao=?`)
        .run(c.numero, c.fornecedor, c.objeto, c.data_inicio, c.data_fim, c.valor_inicial, c.observacoes, arquivado, agora(), u, atual.id, Number(req.body.versao));
      if (r.changes === 0) {
        const quem = atual.atualizado_por || 'outra pessoa';
        throw new ErroHttp(409, `Este contrato foi alterado por ${quem} depois que você abriu. Recarregue e refaça a edição.`, { conflito: true });
      }
    } catch (e) {
      if (emUso(e)) throw new ErroHttp(409, `Já existe um contrato com o número ${c.numero}`);
      throw e;
    }
    auditar(u, arquivado !== atual.arquivado ? (arquivado ? 'contrato arquivado' : 'contrato reativado') : 'contrato editado', atual.id, c.numero);
    avisar({ tipo: 'contrato', id: atual.id, usuario: u });
    res.json(visaoContrato(contratoOu404(atual.id), aditivosDe(atual.id), notasDe(atual.id)));
  });

  app.delete('/api/contratos/:id', (req, res) => {
    const u = usuarioDe(req);
    const c = contratoOu404(req.params.id);
    const qtd = db.prepare('SELECT COUNT(*) n FROM notas WHERE contrato_id = ?').get(c.id).n;
    if (qtd > 0) throw new ErroHttp(409, `O contrato tem ${qtd} nota(s) lançada(s). Arquive-o em vez de excluir.`);
    db.prepare('DELETE FROM contratos WHERE id = ?').run(c.id);
    auditar(u, 'contrato excluído', null, `${c.numero} · ${c.fornecedor}`);
    avisar({ tipo: 'contrato', id: c.id, usuario: u });
    res.status(204).end();
  });

  // ---- notas fiscais --------------------------------------------------------------------
  function lerNota(b) {
    return {
      numero: texto(b.numero, 'Número da nota', { obrigatorio: true, max: 60 }),
      data_emissao: data(b.data_emissao, 'Data de emissão', { obrigatorio: false }),
      data_entrada: data(b.data_entrada || hoje(), 'Data de entrada'),
      valor: valor(b.valor, 'Valor da nota'),
      observacao: texto(b.observacao, 'Observação', { max: 500 }),
    };
  }
  // Saldo que restaria depois de aplicar a nota (ignorando a própria nota, na edição).
  function saldoApos(contratoId, novoValor, ignorarNotaId = 0) {
    const c = contratoOu404(contratoId);
    const total = c.valor_inicial + aditivosDe(c.id).reduce((s, a) => s + a.valor_delta, 0);
    const usado = db.prepare('SELECT COALESCE(SUM(valor),0) s FROM notas WHERE contrato_id = ? AND id <> ?').get(c.id, ignorarNotaId).s;
    return total - usado - novoValor;
  }
  function conferirSaldo(contratoId, n, req, ignorarId = 0) {
    const sobra = saldoApos(contratoId, n.valor, ignorarId);
    if (sobra < 0 && !req.body.confirmarExcesso) {
      throw new ErroHttp(409, `Esta nota excede o saldo do contrato em ${reais(-sobra).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`, { excedeSaldo: true, excesso: reais(-sobra) });
    }
  }

  app.post('/api/contratos/:id/notas', (req, res) => {
    const u = usuarioDe(req);
    const c = contratoOu404(req.params.id);
    const n = lerNota(req.body);
    try {
      const id = transacao(db, () => {
        conferirSaldo(c.id, n, req); // dentro da transação: duas pessoas lançando ao mesmo tempo não furam o saldo
        const r = db.prepare(`INSERT INTO notas (contrato_id, numero, data_emissao, data_entrada, valor, observacao, criado_em, criado_por)
          VALUES (?,?,?,?,?,?,?,?)`).run(c.id, n.numero, n.data_emissao, n.data_entrada, n.valor, n.observacao, agora(), u);
        auditar(u, 'nota lançada', c.id, `NF ${n.numero} · ${reais(n.valor).toFixed(2)}`);
        return Number(r.lastInsertRowid);
      });
      avisar({ tipo: 'nota', contrato_id: c.id, usuario: u });
      res.status(201).json(nota(db.prepare('SELECT * FROM notas WHERE id = ?').get(id)));
    } catch (e) {
      if (emUso(e)) throw new ErroHttp(409, `A NF ${n.numero} já foi lançada neste contrato`);
      throw e;
    }
  });

  app.put('/api/notas/:id', (req, res) => {
    const u = usuarioDe(req);
    const atual = db.prepare('SELECT * FROM notas WHERE id = ?').get(req.params.id);
    if (!atual) throw new ErroHttp(404, 'Nota não encontrada');
    const n = lerNota(req.body);
    try {
      transacao(db, () => {
        conferirSaldo(atual.contrato_id, n, req, atual.id);
        const r = db.prepare(`UPDATE notas SET numero=?, data_emissao=?, data_entrada=?, valor=?, observacao=?, versao=versao+1
          WHERE id=? AND versao=?`).run(n.numero, n.data_emissao, n.data_entrada, n.valor, n.observacao, atual.id, Number(req.body.versao));
        if (r.changes === 0) throw new ErroHttp(409, 'Esta nota foi alterada por outra pessoa. Recarregue e tente de novo.', { conflito: true });
        auditar(u, 'nota editada', atual.contrato_id, `NF ${n.numero} · ${reais(n.valor).toFixed(2)} (antes: ${reais(atual.valor).toFixed(2)})`);
      });
    } catch (e) {
      if (emUso(e)) throw new ErroHttp(409, `A NF ${n.numero} já foi lançada neste contrato`);
      throw e;
    }
    avisar({ tipo: 'nota', contrato_id: atual.contrato_id, usuario: u });
    res.json(nota(db.prepare('SELECT * FROM notas WHERE id = ?').get(atual.id)));
  });

  app.delete('/api/notas/:id', (req, res) => {
    const u = usuarioDe(req);
    const n = db.prepare('SELECT * FROM notas WHERE id = ?').get(req.params.id);
    if (!n) throw new ErroHttp(404, 'Nota não encontrada');
    db.prepare('DELETE FROM notas WHERE id = ?').run(n.id);
    auditar(u, 'nota excluída', n.contrato_id, `NF ${n.numero} · ${reais(n.valor).toFixed(2)}`);
    avisar({ tipo: 'nota', contrato_id: n.contrato_id, usuario: u });
    res.status(204).end();
  });

  // ---- aditivos -------------------------------------------------------------------------
  app.post('/api/contratos/:id/aditivos', (req, res) => {
    const u = usuarioDe(req);
    const c = contratoOu404(req.params.id);
    const delta = req.body.valor_delta === '' || req.body.valor_delta == null ? 0 : valor(req.body.valor_delta, 'Valor do aditivo', { permitirNegativo: true });
    const nova = data(req.body.nova_data_fim, 'Nova data de fim', { obrigatorio: false });
    if (!delta && !nova) throw new ErroHttp(400, 'Informe um valor, uma nova data de fim, ou ambos');
    const descricao = texto(req.body.descricao, 'Descrição', { max: 300 });
    const m = metricas(c, aditivosDe(c.id), [], hoje());
    if (nova && nova <= m.dataFim) throw new ErroHttp(400, `A nova data deve ser posterior à vigência atual (${m.dataFim})`);
    const consumido = db.prepare('SELECT COALESCE(SUM(valor),0) s FROM notas WHERE contrato_id = ?').get(c.id).s;
    if (m.total + delta < consumido) throw new ErroHttp(400, 'O aditivo deixaria o valor do contrato abaixo do que já foi consumido');
    const r = db.prepare('INSERT INTO aditivos (contrato_id, descricao, valor_delta, nova_data_fim, criado_em, criado_por) VALUES (?,?,?,?,?,?)')
      .run(c.id, descricao, delta, nova, agora(), u);
    auditar(u, 'aditivo lançado', c.id, `${descricao || 'sem descrição'} · ${reais(delta).toFixed(2)}${nova ? ` · novo fim ${nova}` : ''}`);
    avisar({ tipo: 'aditivo', contrato_id: c.id, usuario: u });
    res.status(201).json(aditivo(db.prepare('SELECT * FROM aditivos WHERE id = ?').get(r.lastInsertRowid)));
  });

  app.delete('/api/aditivos/:id', (req, res) => {
    const u = usuarioDe(req);
    const a = db.prepare('SELECT * FROM aditivos WHERE id = ?').get(req.params.id);
    if (!a) throw new ErroHttp(404, 'Aditivo não encontrado');
    const c = contratoOu404(a.contrato_id);
    const outros = aditivosDe(c.id).filter((x) => x.id !== a.id);
    const consumido = db.prepare('SELECT COALESCE(SUM(valor),0) s FROM notas WHERE contrato_id = ?').get(c.id).s;
    const total = c.valor_inicial + outros.reduce((s, x) => s + x.valor_delta, 0);
    if (total < consumido) throw new ErroHttp(409, 'Remover este aditivo deixaria o saldo negativo (há notas já lançadas sobre ele)');
    db.prepare('DELETE FROM aditivos WHERE id = ?').run(a.id);
    auditar(u, 'aditivo removido', c.id, a.descricao);
    avisar({ tipo: 'aditivo', contrato_id: c.id, usuario: u });
    res.status(204).end();
  });

  // ---- exportação -----------------------------------------------------------------------
  const csvCel = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita execução de fórmula ao abrir no Excel
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  app.get('/api/exportar/notas.csv', (req, res) => {
    const filtro = req.query.contrato ? 'WHERE c.id = ?' : '';
    const linhas = db.prepare(`SELECT c.numero AS contrato, c.fornecedor, n.numero AS nf, n.data_emissao, n.data_entrada, n.valor, n.observacao
      FROM notas n JOIN contratos c ON c.id = n.contrato_id ${filtro} ORDER BY c.numero, n.data_entrada`).all(...(req.query.contrato ? [req.query.contrato] : []));
    const cab = ['Contrato', 'Fornecedor', 'NF', 'Emissão', 'Entrada', 'Valor', 'Observação'];
    const corpo = linhas.map((l) => [l.contrato, l.fornecedor, l.nf, l.data_emissao, l.data_entrada, reais(l.valor).toFixed(2).replace('.', ','), l.observacao].map(csvCel).join(';'));
    res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="notas-fiscais.csv"')
      .send('﻿' + [cab.join(';'), ...corpo].join('\r\n'));
  });

  // ---- eventos em tempo real ------------------------------------------------------------
  app.get('/api/eventos', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    ouvintes.add(res);
    req.on('close', () => ouvintes.delete(res));
  });

  // ---- interface e erros ----------------------------------------------------------------
  app.use(express.static(UI_DIR));
  app.use('/api', (_req, _res, next) => next(new ErroHttp(404, 'Rota não encontrada')));
  app.use((err, _req, res, _next) => {
    if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message, ...err.extra });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  });

  return {
    app, db,
    // Cópia consistente do banco inteiro, segura mesmo com gente usando (VACUUM INTO).
    backup: (destino) => { db.prepare('VACUUM INTO ?').run(destino); },
    fechar: () => { for (const r of ouvintes) r.end(); db.close(); },
  };
}
