import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco, transacao } from './db.js';
import { metricas, totais, hojeISO, dataValida, emMilesimos, deMilesimos, TIPOS, TIPOS_LANCAVEIS, URGENTE_DIAS } from './calc.js';
import { lerPlanilha, gravarImportacao } from './importar.js';

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const MODALIDADES = ['ENTREGA PARCELADA', 'RECOLHIMENTO', 'ENTREGA ÚNICA'];

class ErroHttp extends Error {
  constructor(status, msg, extra = {}) { super(msg); this.status = status; this.extra = extra; }
}
// Erro "pergunte ao usuário": a operação só segue se o cliente reenviar com confirmar:true.
const confirmacao = (avisos) => new ErroHttp(409, avisos.join(' '), { confirmacao: avisos });

const fmtQ = (m, un = '') => `${deMilesimos(m).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${un ? ' ' + un : ''}`;

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
function quantidade(v, nome, { opcional = false, permitirZero = false } = {}) {
  if ((v === '' || v === null || v === undefined) && opcional) return null;
  const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n)) throw new ErroHttp(400, `${nome} inválida`);
  const m = emMilesimos(n);
  if (m < 0 || (m === 0 && !permitirZero)) throw new ErroHttp(400, `${nome} deve ser maior que zero`);
  if (m > 1e15) throw new ErroHttp(400, `${nome} fora do limite`);
  return m;
}
function dinheiro(v, nome) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  if (!Number.isFinite(n) || n < 0) throw new ErroHttp(400, `${nome} inválido`);
  return Math.round(n * 100);
}

export function criarApp({ dbPath, codigoAcesso = '', hoje = hojeISO } = {}) {
  const db = abrirBanco(dbPath);
  const app = express();
  app.use(express.json({ limit: '200kb' }));

  const ouvintes = new Set();
  const avisar = (evento) => { const msg = `data: ${JSON.stringify(evento)}\n\n`; for (const res of ouvintes) res.write(msg); };
  setInterval(() => { for (const r of ouvintes) r.write(': ping\n\n'); }, 25_000).unref();

  app.get('/api/saude', (_req, res) => res.json({ ok: true, exigeCodigo: Boolean(codigoAcesso) }));
  app.use('/api', (req, _res, next) => {
    if (!codigoAcesso || req.path === '/saude') return next();
    if ((req.get('x-codigo') || req.query.codigo) !== codigoAcesso) return next(new ErroHttp(401, 'Código de acesso inválido'));
    next();
  });
  const usuarioDe = (req) => texto(req.get('x-usuario') ? decodeURIComponent(req.get('x-usuario')) : '', 'Usuário', { max: 60 }) || 'anônimo';
  const agora = () => new Date().toISOString();
  const auditar = (usuario, acao, contratoId, detalhe = '') =>
    db.prepare('INSERT INTO auditoria (quando, usuario, acao, contrato_id, detalhe) VALUES (?,?,?,?,?)').run(agora(), usuario, acao, contratoId, detalhe);

  // ---- leitura ------------------------------------------------------------------------
  const contratoOu404 = (id) => {
    const c = db.prepare('SELECT * FROM contratos WHERE id = ?').get(id);
    if (!c) throw new ErroHttp(404, 'Contrato não encontrado');
    return c;
  };
  const movsDe = (id) => db.prepare('SELECT * FROM movimentos WHERE contrato_id = ? ORDER BY data DESC, id DESC').all(id);
  const abertasDe = (id) => db.prepare("SELECT COALESCE(SUM(quantidade),0) s FROM solicitacoes WHERE contrato_id = ? AND status = 'aberta' AND modalidade <> 'RECOLHIMENTO'").get(id).s;

  const MILESIMOS_METR = ['qtdContratada', 'consumido', 'saldo', 'saldoAplicacao', 'saldoLocacao', 'solicitadoEmAberto', 'saldoAposAbertas', 'consumoMedioMensal', 'necessarioMensal', 'sobraNoFim'];
  function visao(c, movs, abertas) {
    const m = metricas(c, movs, abertas, hoje());
    for (const k of MILESIMOS_METR) if (m[k] !== null) m[k] = deMilesimos(m[k]);
    return {
      id: c.id, produto: c.produto, codigo: c.codigo, numero: c.numero, fornecedor: c.fornecedor, unidade: c.unidade, qtd_contratada: deMilesimos(c.qtd_contratada),
      data_inicio: c.data_inicio, data_fim: c.data_fim, aquisicao: c.aquisicao, requisicao: c.requisicao, entrega_unica: Boolean(c.entrega_unica),
      qtd_locacao: c.qtd_locacao === null ? null : deMilesimos(c.qtd_locacao), planejador: c.planejador,
      valor_unit_produto: c.valor_unit_produto === null ? null : c.valor_unit_produto / 100,
      valor_unit_locacao: c.valor_unit_locacao === null ? null : c.valor_unit_locacao / 100,
      emails: c.emails, importancia: c.importancia, novo_processo: c.novo_processo,
      np_valor: c.np_valor === null ? null : c.np_valor / 100, np_qtd: c.np_qtd === null ? null : deMilesimos(c.np_qtd),
      np_prazo: c.np_prazo, np_inicio: c.np_inicio, np_termino: c.np_termino,
      observacoes: c.observacoes, arquivado: Boolean(c.arquivado), versao: c.versao, atualizado_em: c.atualizado_em, atualizado_por: c.atualizado_por,
      ...m,
    };
  }
  const mov = (m) => ({ ...m, quantidade: deMilesimos(m.quantidade) });
  const sol = (s) => ({ ...s, quantidade: deMilesimos(s.quantidade) });

  const todos = (incluirArquivados = false) =>
    db.prepare(`SELECT * FROM contratos ${incluirArquivados ? '' : 'WHERE arquivado = 0'} ORDER BY produto`).all()
      .map((c) => visao(c, movsDe(c.id), abertasDe(c.id)));

  const solicitacoesAbertas = () => db.prepare(`SELECT s.*, c.produto, c.unidade, c.fornecedor, c.numero AS contrato_numero FROM solicitacoes s
      JOIN contratos c ON c.id = s.contrato_id WHERE s.status = 'aberta' AND c.arquivado = 0 ORDER BY s.data, s.id`).all().map(sol);

  app.get('/api/dashboard', (_req, res) => {
    const contratos = todos();
    const vigentes = contratos.filter((c) => !c.semContrato && c.iniciado);
    const ordem = { critico: 0, atencao: 1, encerrado: 2, ok: 3, futuro: 4 };
    contratos.sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || a.diasRestantes - b.diasRestantes);
    const recentes = db.prepare(`SELECT m.*, c.produto, c.unidade FROM movimentos m JOIN contratos c ON c.id = m.contrato_id
      WHERE c.arquivado = 0 ORDER BY m.data DESC, m.id DESC LIMIT 8`).all().map(mov);
    const abertas = solicitacoesAbertas();
    res.json({
      hoje: hoje(),
      resumo: {
        contratos: contratos.length,
        vigentes: vigentes.length,
        solicitarPedido: contratos.filter((c) => c.statusProcesso === 'SOLICITAR PEDIDO').length,
        emitirReq: contratos.filter((c) => c.statusProcesso === 'EMITIR NOVA REQ').length,
        vencendo210: contratos.filter((c) => c.iniciado && !c.vencido && c.diasRestantes <= 210).length,
        saldoBaixo: contratos.filter((c) => !c.semContrato && c.pctSaldo <= 30).length,
        semContrato: contratos.filter((c) => c.semContrato).length,
        solicitacoesAbertas: abertas.length,
      },
      contratos, recentes, solicitacoes: abertas,
    });
  });

  app.get('/api/contratos', (req, res) => res.json(todos(req.query.arquivados === '1')));
  app.get('/api/contratos/:id', (req, res) => {
    const c = contratoOu404(req.params.id);
    const movs = movsDe(c.id);
    res.json({
      ...visao(c, movs, abertasDe(c.id)),
      movimentos: movs.map(mov),
      solicitacoes: db.prepare('SELECT * FROM solicitacoes WHERE contrato_id = ? ORDER BY id DESC LIMIT 50').all(c.id).map(sol),
      historico: db.prepare('SELECT * FROM auditoria WHERE contrato_id = ? ORDER BY id DESC LIMIT 100').all(c.id),
    });
  });

  // ---- contratos ----------------------------------------------------------------------
  function lerContrato(b) {
    const o = {
      produto: texto(b.produto, 'Produto', { obrigatorio: true, max: 120 }),
      codigo: texto(b.codigo, 'Código do material', { max: 40 }),
      numero: texto(b.numero, 'Nº do contrato', { obrigatorio: true, max: 60 }),
      fornecedor: texto(b.fornecedor, 'Fornecedor', { obrigatorio: true, max: 160 }),
      unidade: texto(b.unidade, 'Unidade', { obrigatorio: true, max: 12 }).toUpperCase(),
      qtd_contratada: quantidade(b.qtd_contratada, 'Quantidade contratada'),
      data_inicio: data(b.data_inicio, 'Início da vigência'),
      data_fim: data(b.data_fim, 'Fim da vigência'),
      aquisicao: texto(b.aquisicao, 'Aquisição', { max: 20 }),
      requisicao: texto(b.requisicao, 'Requisição', { max: 60 }),
      entrega_unica: b.entrega_unica ? 1 : 0,
      qtd_locacao: quantidade(b.qtd_locacao, 'Quantidade de locação', { opcional: true, permitirZero: true }) || null,
      planejador: texto(b.planejador, 'Planejador', { max: 80 }),
      valor_unit_produto: dinheiro(b.valor_unit_produto, 'Valor unitário do produto'),
      valor_unit_locacao: dinheiro(b.valor_unit_locacao, 'Valor unitário da locação'),
      emails: texto(b.emails, 'E-mails', { max: 1000 }),
      importancia: texto(b.importancia, 'Importância operacional', { max: 2000 }),
      novo_processo: texto(b.novo_processo, 'Novo processo', { max: 80 }),
      np_valor: dinheiro(b.np_valor, 'Valor do novo processo'),
      np_qtd: quantidade(b.np_qtd, 'Qtd. do novo processo', { opcional: true, permitirZero: true }) || null,
      np_prazo: texto(b.np_prazo, 'Prazo do novo processo', { max: 40 }),
      np_inicio: data(b.np_inicio, 'Início do novo processo', { obrigatorio: false }),
      np_termino: data(b.np_termino, 'Término do novo processo', { obrigatorio: false }),
      observacoes: texto(b.observacoes, 'Observações', { max: 2000 }),
    };
    if (o.aquisicao && !['Pregão', 'PV'].includes(o.aquisicao)) throw new ErroHttp(400, 'Aquisição deve ser Pregão ou PV');
    if (o.data_fim <= o.data_inicio) throw new ErroHttp(400, 'O fim da vigência deve ser depois do início');
    return o;
  }
  const COLS = ['produto', 'codigo', 'numero', 'fornecedor', 'unidade', 'qtd_contratada', 'data_inicio', 'data_fim', 'aquisicao', 'requisicao', 'entrega_unica', 'qtd_locacao', 'planejador',
    'valor_unit_produto', 'valor_unit_locacao', 'emails', 'importancia', 'novo_processo', 'np_valor', 'np_qtd', 'np_prazo', 'np_inicio', 'np_termino', 'observacoes'];
  const duplicado = (e) => e instanceof Error && /UNIQUE/.test(e.message);

  app.post('/api/contratos', (req, res) => {
    const u = usuarioDe(req);
    const c = lerContrato(req.body);
    try {
      const id = transacao(db, () => {
        const r = db.prepare(`INSERT INTO contratos (${COLS.join(',')}, criado_em, atualizado_em, atualizado_por) VALUES (${COLS.map(() => '?').join(',')},?,?,?)`)
          .run(...COLS.map((k) => c[k]), agora(), agora(), u);
        auditar(u, 'contrato criado', r.lastInsertRowid, `${c.produto} · ${c.numero}`);
        return Number(r.lastInsertRowid);
      });
      avisar({ tipo: 'contrato', id, usuario: u });
      res.status(201).json(visao(contratoOu404(id), [], 0));
    } catch (e) {
      if (duplicado(e)) throw new ErroHttp(409, `Já existe o contrato ${c.numero} para ${c.produto}`);
      throw e;
    }
  });

  app.put('/api/contratos/:id', (req, res) => {
    const u = usuarioDe(req);
    const atual = contratoOu404(req.params.id);
    const c = lerContrato(req.body);
    const arquivado = req.body.arquivado === undefined ? atual.arquivado : req.body.arquivado ? 1 : 0;
    try {
      const r = db.prepare(`UPDATE contratos SET ${COLS.map((k) => `${k}=?`).join(', ')}, arquivado=?, versao=versao+1, atualizado_em=?, atualizado_por=? WHERE id=? AND versao=?`)
        .run(...COLS.map((k) => c[k]), arquivado, agora(), u, atual.id, Number(req.body.versao));
      if (r.changes === 0) throw new ErroHttp(409, `Este contrato foi alterado por ${atual.atualizado_por || 'outra pessoa'} depois que você abriu. Recarregue e refaça a edição.`, { conflito: true });
    } catch (e) {
      if (duplicado(e)) throw new ErroHttp(409, `Já existe o contrato ${c.numero} para ${c.produto}`);
      throw e;
    }
    auditar(u, arquivado !== atual.arquivado ? (arquivado ? 'contrato arquivado' : 'contrato reativado') : 'contrato editado', atual.id, `${c.produto} · ${c.numero}`);
    avisar({ tipo: 'contrato', id: atual.id, usuario: u });
    res.json(visao(contratoOu404(atual.id), movsDe(atual.id), abertasDe(atual.id)));
  });

  app.delete('/api/contratos/:id', (req, res) => {
    const u = usuarioDe(req);
    const c = contratoOu404(req.params.id);
    const n = db.prepare('SELECT COUNT(*) n FROM movimentos WHERE contrato_id = ?').get(c.id).n;
    if (n > 0) throw new ErroHttp(409, `O contrato tem ${n} movimento(s) lançado(s). Arquive-o em vez de excluir.`);
    db.prepare('DELETE FROM contratos WHERE id = ?').run(c.id);
    auditar(u, 'contrato excluído', null, `${c.produto} · ${c.numero}`);
    avisar({ tipo: 'contrato', id: c.id, usuario: u });
    res.status(204).end();
  });

  // ---- movimentos (notas fiscais e demais lançamentos) ---------------------------------
  function lerMov(b) {
    const tipo = texto(b.tipo, 'Tipo', { obrigatorio: true }).toUpperCase();
    if (!TIPOS_LANCAVEIS.includes(tipo)) throw new ErroHttp(400, `Tipo inválido: ${tipo}`);
    return {
      tipo,
      data: data(b.data || hoje(), 'Data'),
      nf: texto(b.nf, 'NF', { max: 60 }),
      quantidade: quantidade(b.quantidade, 'Quantidade'),
      observacao: texto(b.observacao, 'Observação', { max: 500 }),
    };
  }
  // O que perguntar ao usuário antes de gravar o movimento (a planilha bloqueava saldo insuficiente).
  function avisosMov(c, m, ignorarId = 0) {
    const outros = db.prepare('SELECT tipo, quantidade, nf FROM movimentos WHERE contrato_id = ? AND id <> ?').all(c.id, ignorarId);
    const t = totais([...outros, m]);
    const av = [];
    if (t.consumo > c.qtd_contratada && TIPOS[m.tipo].efeito === 'consumo' && TIPOS[m.tipo].sinal > 0)
      av.push(`Saldo contratual insuficiente: este lançamento excede a quantidade contratada em ${fmtQ(t.consumo - c.qtd_contratada, c.unidade)}.`);
    if (c.qtd_locacao !== null && t.locacao > c.qtd_locacao && TIPOS[m.tipo].efeito === 'locacao')
      av.push(`Saldo de locação insuficiente: excede em ${fmtQ(t.locacao - c.qtd_locacao)}.`);
    if (t.aplicacao < 0 && TIPOS[m.tipo].efeito === 'aplicacao')
      av.push('Recolhimento maior do que o total aplicado (saldo de aplicação ficaria negativo).');
    if (m.nf && outros.some((o) => o.nf === m.nf && o.tipo === m.tipo)) av.push(`A NF ${m.nf} já foi lançada neste contrato como ${m.tipo}.`);
    return av;
  }
  const exigirConfirmacao = (av, req) => { if (av.length && !req.body.confirmar) throw confirmacao(av); };

  app.post('/api/contratos/:id/movimentos', (req, res) => {
    const u = usuarioDe(req);
    const c = contratoOu404(req.params.id);
    const m = lerMov(req.body);
    const id = transacao(db, () => { // conferência dentro da transação: lançamentos simultâneos não furam o saldo
      exigirConfirmacao(avisosMov(c, m), req);
      const r = db.prepare('INSERT INTO movimentos (contrato_id, tipo, data, nf, quantidade, observacao, criado_em, criado_por) VALUES (?,?,?,?,?,?,?,?)')
        .run(c.id, m.tipo, m.data, m.nf, m.quantidade, m.observacao, agora(), u);
      auditar(u, `${m.tipo.toLowerCase()} lançada`, c.id, `${m.nf ? `NF ${m.nf} · ` : ''}${fmtQ(m.quantidade, c.unidade)}`);
      if (req.body.solicitacao_id) {
        db.prepare("UPDATE solicitacoes SET status = 'atendida' WHERE id = ? AND contrato_id = ? AND status = 'aberta'").run(Number(req.body.solicitacao_id), c.id);
      }
      return Number(r.lastInsertRowid);
    });
    avisar({ tipo: 'movimento', contrato_id: c.id, usuario: u });
    res.status(201).json(mov(db.prepare('SELECT * FROM movimentos WHERE id = ?').get(id)));
  });

  app.put('/api/movimentos/:id', (req, res) => {
    const u = usuarioDe(req);
    const atual = db.prepare('SELECT * FROM movimentos WHERE id = ?').get(req.params.id);
    if (!atual) throw new ErroHttp(404, 'Movimento não encontrado');
    const c = contratoOu404(atual.contrato_id);
    const m = lerMov(req.body);
    transacao(db, () => {
      exigirConfirmacao(avisosMov(c, m, atual.id), req);
      const r = db.prepare('UPDATE movimentos SET tipo=?, data=?, nf=?, quantidade=?, observacao=?, versao=versao+1 WHERE id=? AND versao=?')
        .run(m.tipo, m.data, m.nf, m.quantidade, m.observacao, atual.id, Number(req.body.versao));
      if (r.changes === 0) throw new ErroHttp(409, 'Este lançamento foi alterado por outra pessoa. Recarregue e tente de novo.', { conflito: true });
      auditar(u, 'lançamento editado', c.id, `${atual.tipo} ${atual.nf ? `NF ${atual.nf} ` : ''}${fmtQ(atual.quantidade)} → ${m.tipo} ${m.nf ? `NF ${m.nf} ` : ''}${fmtQ(m.quantidade)}`);
    });
    avisar({ tipo: 'movimento', contrato_id: c.id, usuario: u });
    res.json(mov(db.prepare('SELECT * FROM movimentos WHERE id = ?').get(atual.id)));
  });

  app.delete('/api/movimentos/:id', (req, res) => {
    const u = usuarioDe(req);
    const m = db.prepare('SELECT * FROM movimentos WHERE id = ?').get(req.params.id);
    if (!m) throw new ErroHttp(404, 'Movimento não encontrado');
    db.prepare('DELETE FROM movimentos WHERE id = ?').run(m.id);
    auditar(u, 'lançamento excluído', m.contrato_id, `${m.tipo} ${m.nf ? `NF ${m.nf} · ` : ''}${fmtQ(m.quantidade)}`);
    avisar({ tipo: 'movimento', contrato_id: m.contrato_id, usuario: u });
    res.status(204).end();
  });

  // ---- solicitações de fornecimento -----------------------------------------------------
  app.get('/api/solicitacoes', (req, res) => {
    const filtro = req.query.status === 'todas' ? '' : "WHERE s.status = 'aberta'";
    res.json(db.prepare(`SELECT s.*, c.produto, c.unidade, c.fornecedor, c.numero AS contrato_numero FROM solicitacoes s
      JOIN contratos c ON c.id = s.contrato_id ${filtro} ORDER BY s.lote DESC, s.id LIMIT 500`).all().map(sol));
  });

  app.get('/api/solicitacoes/lote/:lote', (req, res) => {
    const itens = db.prepare(`SELECT s.*, c.produto, c.codigo, c.unidade, c.fornecedor, c.numero AS contrato_numero, c.data_fim, c.emails FROM solicitacoes s
      JOIN contratos c ON c.id = s.contrato_id WHERE s.lote = ? ORDER BY s.id`).all(req.params.lote);
    if (!itens.length) throw new ErroHttp(404, 'Solicitação não encontrada');
    res.json({ lote: Number(req.params.lote), fornecedor: itens[0].fornecedor, data: itens[0].data, emails: itens[0].emails, criado_por: itens[0].criado_por, itens: itens.map(sol) });
  });

  app.post('/api/solicitacoes', (req, res) => {
    const u = usuarioDe(req);
    const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
    if (!itens.length) throw new ErroHttp(400, 'Inclua ao menos um item');
    if (itens.length > 12) throw new ErroHttp(400, 'Máximo de 12 itens por solicitação');
    const lidos = itens.map((it, i) => {
      const c = contratoOu404(it.contrato_id);
      const modalidade = texto(it.modalidade || 'ENTREGA PARCELADA', 'Modalidade').toUpperCase();
      if (!MODALIDADES.includes(modalidade)) throw new ErroHttp(400, `Item ${i + 1}: modalidade inválida`);
      return { c, modalidade, quantidade: quantidade(it.quantidade, `Item ${i + 1}: quantidade`), observacao: texto(it.observacao, 'Observação', { max: 300 }) };
    });
    const fornecedores = new Set(lidos.map((l) => l.c.fornecedor));
    if (fornecedores.size > 1) throw new ErroHttp(400, `ATENÇÃO: fornecedores diferentes na mesma solicitação (${[...fornecedores].join(', ')})`);
    const lote = transacao(db, () => {
      const av = [];
      for (const l of lidos) {
        const m = metricas(l.c, movsDe(l.c.id), 0, hoje());
        if (m.diasRestantes < 0) throw new ErroHttp(409, `${l.c.produto}: CONTRATO ENCERRADO — não é possível solicitar.`);
        if (l.modalidade === 'RECOLHIMENTO') {
          if (l.quantidade > m.saldoAplicacao) av.push(`${l.c.produto}: recolher ${fmtQ(l.quantidade)} cilindro(s), mas só há ${fmtQ(Math.max(0, m.saldoAplicacao))} em campo.`);
          continue;
        }
        if (l.quantidade > m.saldo) av.push(`${l.c.produto}: solicitação de ${fmtQ(l.quantidade, l.c.unidade)} excede o saldo (${fmtQ(Math.max(0, m.saldo), l.c.unidade)}).`);
        else if (l.quantidade === m.saldo) av.push(`${l.c.produto}: ÚLTIMO FORNECIMENTO — esta solicitação consome todo o saldo.`);
        if (m.diasRestantes <= URGENTE_DIAS) av.push(`${l.c.produto}: contrato termina em ${m.diasRestantes} dia(s) — solicitar emissão de nota fiscal urgente.`);
      }
      exigirConfirmacao(av, req);
      let primeiro = 0;
      for (const l of lidos) {
        const r = db.prepare('INSERT INTO solicitacoes (lote, contrato_id, data, modalidade, quantidade, observacao, criado_em, criado_por) VALUES (?,?,?,?,?,?,?,?)')
          .run(primeiro || 0, l.c.id, hoje(), l.modalidade, l.quantidade, l.observacao, agora(), u);
        if (!primeiro) { primeiro = Number(r.lastInsertRowid); db.prepare('UPDATE solicitacoes SET lote = ? WHERE id = ?').run(primeiro, primeiro); }
        else db.prepare('UPDATE solicitacoes SET lote = ? WHERE id = ?').run(primeiro, Number(r.lastInsertRowid));
        auditar(u, 'solicitação emitida', l.c.id, `${l.modalidade} · ${fmtQ(l.quantidade, l.c.unidade)}`);
      }
      return primeiro;
    });
    avisar({ tipo: 'solicitacao', usuario: u });
    res.status(201).json({ lote });
  });

  app.put('/api/solicitacoes/:id', (req, res) => {
    const u = usuarioDe(req);
    const s = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(req.params.id);
    if (!s) throw new ErroHttp(404, 'Solicitação não encontrada');
    const status = req.body.status;
    if (!['aberta', 'atendida', 'cancelada'].includes(status)) throw new ErroHttp(400, 'Status inválido');
    db.prepare('UPDATE solicitacoes SET status = ? WHERE id = ?').run(status, s.id);
    auditar(u, `solicitação ${status}`, s.contrato_id, `${s.modalidade} · ${fmtQ(s.quantidade)}`);
    avisar({ tipo: 'solicitacao', usuario: u });
    res.json(sol(db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(s.id)));
  });

  // ---- importação da planilha antiga ----------------------------------------------------
  app.post('/api/importar', express.raw({ type: '*/*', limit: '60mb' }), (req, res) => {
    const u = usuarioDe(req);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ErroHttp(400, 'Envie o arquivo da planilha');
    const existentes = db.prepare('SELECT COUNT(*) n FROM contratos').get().n;
    if (existentes && req.query.substituir !== '1') throw new ErroHttp(409, `O sistema já tem ${existentes} contrato(s). Importar apagaria os dados atuais.`, { jaTemDados: true });
    let dados;
    try { dados = lerPlanilha(req.body, hoje()); }
    catch (e) { throw new ErroHttp(400, e.message || 'Não foi possível ler a planilha'); }
    if (!dados.contratos.length) throw new ErroHttp(400, 'Nenhum contrato válido encontrado na aba GESTOR DE CONTRATOS.');
    const r = transacao(db, () => {
      if (existentes) db.exec('DELETE FROM solicitacoes; DELETE FROM movimentos; DELETE FROM contratos;');
      const out = gravarImportacao(db, dados, { usuario: u, agora });
      auditar(u, 'planilha importada', null, `${out.contratos} contratos, ${out.movimentos} movimentos`);
      return out;
    });
    avisar({ tipo: 'importacao', usuario: u });
    res.json({ ...r, avisos: dados.avisos, divergencias: dados.conferencia.filter((c) => !c.ok) });
  });

  // ---- exportação -----------------------------------------------------------------------
  const csvCel = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita execução de fórmula ao abrir no Excel
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  app.get('/api/exportar/movimentos.csv', (req, res) => {
    const filtro = req.query.contrato ? 'WHERE c.id = ?' : '';
    const linhas = db.prepare(`SELECT c.produto, c.numero AS contrato, c.fornecedor, c.unidade, m.tipo, m.data, m.nf, m.quantidade, m.observacao
      FROM movimentos m JOIN contratos c ON c.id = m.contrato_id ${filtro} ORDER BY c.produto, m.data, m.id`).all(...(req.query.contrato ? [req.query.contrato] : []));
    const cab = ['Produto', 'Contrato', 'Fornecedor', 'UF', 'Tipo', 'Data', 'NF', 'Quantidade', 'Observação'];
    const corpo = linhas.map((l) => [l.produto, l.contrato, l.fornecedor, l.unidade, l.tipo, l.data, l.nf, String(deMilesimos(l.quantidade)).replace('.', ','), l.observacao].map(csvCel).join(';'));
    res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="movimentos.csv"').send('﻿' + [cab.join(';'), ...corpo].join('\r\n'));
  });

  app.get('/api/eventos', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    ouvintes.add(res);
    req.on('close', () => ouvintes.delete(res));
  });

  app.use(express.static(UI_DIR));
  app.use('/api', (_req, _res, next) => next(new ErroHttp(404, 'Rota não encontrada')));
  app.use((err, _req, res, _next) => {
    if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message, ...err.extra });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ erro: 'Arquivo grande demais' });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  });

  return {
    app, db,
    backup: (destino) => { db.prepare('VACUUM INTO ?').run(destino); },
    fechar: () => { for (const r of ouvintes) r.end(); db.close(); },
  };
}
