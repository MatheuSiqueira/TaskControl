// Lê a planilha GESTOR DE CONTRATOS (.xlsm/.xlsx) direto do XML — sem carregar a pasta inteira
// (uma das abas tem ~80 MB de formatação) — e converte para o modelo do sistema.
import { unzipSync, strFromU8 } from 'fflate';
import { metricas, totais, TIPOS, emMilesimos, dataValida } from './calc.js';

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const dec = (s) => s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);/g, (m, n, d) => (d ? String.fromCodePoint(+d) : ENT[m]));

function lerCelulas(xml, strings, { ateLinha = Infinity } = {}) {
  const mapa = new Map(); // "A12" -> valor
  const re = /<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (!m[2]) continue;
    const r = /\br="([A-Z]+)(\d+)"/.exec(m[1]);
    if (!r || +r[2] > ateLinha) continue;
    const t = /\bt="(\w+)"/.exec(m[1])?.[1];
    let v;
    const vm = /<v>([\s\S]*?)<\/v>/.exec(m[2]);
    if (t === 'inlineStr') v = dec([...m[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
    else if (!vm) continue;
    else if (t === 's') v = strings[+vm[1]];
    else if (t === 'str') v = dec(vm[1]);
    else if (t === 'b') v = vm[1] === '1';
    else if (t === 'e') continue; // #N/A, #REF!...
    else v = Number(vm[1]);
    mapa.set(r[1] + r[2], v);
  }
  return mapa;
}

const serialParaISO = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000).toISOString().slice(0, 10);
export function paraData(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serialParaISO(v) : null;
  const s = String(v).trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (br) { const iso = `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`; return dataValida(iso) ? iso : null; }
  return dataValida(s) ? s : null;
}
const txt = (v) => (v === undefined || v === null ? '' : String(v).trim());
const vazioOuZero = (v) => { const s = txt(v); return s === '' || s === '-' || s === '0'; };
// Na planilha há números gravados como texto ("300", "1.5"): aceitamos os dois.
const numOuNull = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(v)) return Number(v.replace(',', '.'));
  return null;
};

export function lerPlanilha(buffer, hoje) {
  const avisos = [];
  const pre = unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), {
    filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml)$/.test(f.name),
  });
  if (!pre['xl/workbook.xml']) throw new Error('Arquivo não parece ser uma planilha do Excel (.xlsx/.xlsm).');
  const strings = [...strFromU8(pre['xl/sharedStrings.xml'] || new Uint8Array()).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((x) => dec([...x[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rels = new Map([...strFromU8(pre['xl/_rels/workbook.xml.rels']).matchAll(/<Relationship\b[^>]*>/g)].map((x) => [
    /\bId="([^"]+)"/.exec(x[0])[1], /\bTarget="([^"]+)"/.exec(x[0])[1].replace(/^\/?(xl\/)?/, 'xl/')]));
  const abas = [...strFromU8(pre['xl/workbook.xml']).matchAll(/<sheet\b[^>]*>/g)].map((x) => ({
    nome: dec(/\bname="([^"]*)"/.exec(x[0])[1]),
    oculta: /state="(hidden|veryHidden)"/.test(x[0]),
    arquivo: rels.get(/\br:id="([^"]+)"/.exec(x[0])[1]),
  }));
  const aba = (nome) => abas.find((a) => a.nome === nome) || abas.find((a) => a.nome.trim() === nome.trim());
  const gestor = aba('GESTOR DE CONTRATOS');
  if (!gestor) throw new Error('Não encontrei a aba "GESTOR DE CONTRATOS".');
  const emAberto = aba('SOLICITAÇÕES EM ABERTO');

  // Lê só o que precisamos: gestor, solicitações em aberto e abas de produto (nunca "SOLICITAÇÃO DE FORNECIMENTO", 80 MB).
  const nomesGestor = new Set();
  const dadosGestor = (() => {
    const z = unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), { filter: (f) => f.name === gestor.arquivo });
    return lerCelulas(strFromU8(z[gestor.arquivo]), strings);
  })();
  const linhasGestor = [];
  for (let r = 2; r < 400; r++) if (txt(dadosGestor.get('A' + r))) { linhasGestor.push(r); nomesGestor.add(txt(dadosGestor.get('A' + r))); }

  const produtoAbas = linhasGestor.map((r) => ({ r, aba: aba(txt(dadosGestor.get('A' + r))) }));
  const arquivosNecessarios = new Set(produtoAbas.filter((x) => x.aba).map((x) => x.aba.arquivo));
  if (emAberto) arquivosNecessarios.add(emAberto.arquivo);
  const z = unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), { filter: (f) => arquivosNecessarios.has(f.name) });

  const contratos = [];
  const movimentos = []; // { ref: indice do contrato, ... }
  const conferencia = [];
  for (const { r, aba: a } of produtoAbas) {
    const g = (col) => dadosGestor.get(col + r);
    const produto = txt(g('A'));
    const ini = paraData(g('G')), fim = paraData(g('H'));
    const qtd = numOuNull(g('C'));
    const unidade = txt(g('D'));
    if (!ini || !fim || qtd === null || !unidade || !txt(g('J'))) {
      avisos.push(`Contrato "${produto}" (linha ${r}) ignorado: faltam dados obrigatórios (quantidade, unidade, fornecedor ou datas válidas).`);
      continue;
    }
    const req = txt(g('R'));
    const locacao = numOuNull(g('P'));
    const c = {
      produto, codigo: txt(g('B')), numero: txt(g('K')), fornecedor: txt(g('J')), unidade,
      qtd_contratada: emMilesimos(qtd), data_inicio: ini, data_fim: fim,
      aquisicao: ['Pregão', 'PV'].includes(txt(g('S'))) ? txt(g('S')) : '',
      requisicao: /ENTREGA ÚNICA/i.test(req) ? '' : req, entrega_unica: /ENTREGA ÚNICA/i.test(req) ? 1 : 0,
      qtd_locacao: locacao === null || locacao === 0 ? null : emMilesimos(locacao),
      emails: txt(g('T')), importancia: txt(g('Z')),
      novo_processo: vazioOuZero(g('O')) ? '' : txt(g('O')),
      np_valor: numOuNull(g('U')) ? Math.round(numOuNull(g('U')) * 100) : null, np_qtd: numOuNull(g('V')) ? emMilesimos(numOuNull(g('V'))) : null,
      np_prazo: txt(g('W')), np_inicio: paraData(g('X')), np_termino: paraData(g('Y')),
      planejador: '', valor_unit_produto: null, valor_unit_locacao: null, observacoes: '',
    };
    if (!c.numero) { c.numero = 'S/N'; avisos.push(`"${produto}": contrato sem número, usado "S/N".`); }
    const idx = contratos.length;
    if (!a) {
      avisos.push(`"${produto}": aba de movimentos não encontrada; importado sem histórico.`);
    } else {
      const s = lerCelulas(strFromU8(z[a.arquivo]), strings, { ateLinha: 1100 });
      c.planejador = txt(s.get('A16'));
      c.valor_unit_produto = numOuNull(s.get('E16')) !== null ? Math.round(numOuNull(s.get('E16')) * 100) : null;
      c.valor_unit_locacao = numOuNull(s.get('G16')) !== null ? Math.round(numOuNull(s.get('G16')) * 100) : null;
      let semData = 0, tipoDesconhecido = new Map();
      for (let row = 19; row <= 1000; row++) {
        const tipo = txt(s.get('A' + row)).toUpperCase();
        if (tipo === '*') break; // marcador de fim da tabela
        if (!tipo) continue;
        if (!TIPOS[tipo]) { tipoDesconhecido.set(tipo, (tipoDesconhecido.get(tipo) || 0) + 1); continue; }
        const q = numOuNull(s.get('G' + row));
        const data = paraData(s.get('C' + row));
        if (q === null || q <= 0) { avisos.push(`"${produto}" linha ${row}: ${tipo} sem quantidade válida, ignorada.`); continue; }
        if (!data) { semData++; }
        const nf = s.get('E' + row);
        movimentos.push({
          ref: idx, tipo, data: data || ini, quantidade: emMilesimos(q),
          nf: typeof nf === 'number' ? String(nf) : txt(nf), observacao: txt(s.get('I' + row)),
        });
      }
      if (semData) avisos.push(`"${produto}": ${semData} movimento(s) sem data válida; usada a data de início do contrato.`);
      for (const [t, n] of tipoDesconhecido) avisos.push(`"${produto}": ${n} linha(s) com tipo "${t}" não reconhecido, ignoradas.`);
    }
    contratos.push(c);

    // Conferência: o saldo que o sistema calcula bate com o que a planilha mostrava?
    const movs = movimentos.filter((m) => m.ref === idx);
    const t = totais(movs);
    const mostrado = { saldo: numOuNull(g('E')), aplicacao: numOuNull(g('L')), locacao: numOuNull(g('Q')) };
    const calc = { saldo: (c.qtd_contratada - t.consumo) / 1000, aplicacao: t.aplicacao / 1000, locacao: c.qtd_locacao === null ? null : (c.qtd_locacao - t.locacao) / 1000 };
    const dif = [];
    for (const k of ['saldo', 'aplicacao', 'locacao']) {
      if (mostrado[k] !== null && calc[k] !== null && Math.abs(mostrado[k] - calc[k]) > 0.0005) dif.push(`${k}: planilha ${mostrado[k]} × sistema ${calc[k]}`);
    }
    conferencia.push({ produto, ok: dif.length === 0, diferencas: dif });
  }

  const solicitacoes = [];
  if (emAberto) {
    const s = lerCelulas(strFromU8(z[emAberto.arquivo]), strings, { ateLinha: 500 });
    for (let row = 7; row < 500; row++) {
      const prod = txt(s.get('B' + row));
      if (!prod) continue;
      const ref = contratos.findIndex((c) => c.produto === prod || c.produto.trim() === prod);
      const q = numOuNull(s.get('F' + row));
      if (ref < 0 || q === null || q <= 0) { avisos.push(`Solicitação em aberto de "${prod}" (linha ${row}) ignorada: contrato ou quantidade inválidos.`); continue; }
      const o = s.get('G' + row);
      solicitacoes.push({ ref, data: paraData(s.get('E' + row)) || hoje, quantidade: emMilesimos(q), modalidade: 'ENTREGA PARCELADA',
        observacao: typeof o === 'number' ? (paraData(o) ? `Ref. ${paraData(o).split('-').reverse().join('/')}` : String(o)) : txt(o) });
    }
  }
  return { contratos, movimentos, solicitacoes, avisos, conferencia };
}

/** Grava tudo numa transação. Retorna contagens. */
export function gravarImportacao(db, dados, { usuario, agora }) {
  const ins = {
    c: db.prepare(`INSERT INTO contratos (produto, codigo, numero, fornecedor, unidade, qtd_contratada, data_inicio, data_fim, aquisicao, requisicao, entrega_unica,
      qtd_locacao, planejador, valor_unit_produto, valor_unit_locacao, emails, importancia, novo_processo, np_valor, np_qtd, np_prazo, np_inicio, np_termino,
      criado_em, atualizado_em, atualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    m: db.prepare('INSERT INTO movimentos (contrato_id, tipo, data, nf, quantidade, observacao, criado_em, criado_por) VALUES (?,?,?,?,?,?,?,?)'),
    s: db.prepare('INSERT INTO solicitacoes (lote, contrato_id, data, modalidade, quantidade, observacao, criado_em, criado_por) VALUES (?,?,?,?,?,?,?,?)'),
  };
  const t = agora();
  const ids = dados.contratos.map((c) => Number(ins.c.run(c.produto, c.codigo, c.numero, c.fornecedor, c.unidade, c.qtd_contratada, c.data_inicio, c.data_fim, c.aquisicao,
    c.requisicao, c.entrega_unica, c.qtd_locacao, c.planejador, c.valor_unit_produto, c.valor_unit_locacao, c.emails, c.importancia, c.novo_processo,
    c.np_valor, c.np_qtd, c.np_prazo, c.np_inicio, c.np_termino, t, t, usuario).lastInsertRowid));
  for (const m of dados.movimentos) ins.m.run(ids[m.ref], m.tipo, m.data, m.nf, m.quantidade, m.observacao, t, `${usuario} (importação)`);
  // cada solicitação importada vira seu próprio lote
  let lote = (db.prepare('SELECT COALESCE(MAX(lote),0) n FROM solicitacoes').get().n) || 0;
  for (const s of dados.solicitacoes) ins.s.run(++lote, ids[s.ref], s.data, s.modalidade, s.quantidade, s.observacao, t, `${usuario} (importação)`);
  return { contratos: ids.length, movimentos: dados.movimentos.length, solicitacoes: dados.solicitacoes.length };
}
