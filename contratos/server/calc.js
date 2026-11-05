// Regras de negócio puras (sem disco/rede) — testáveis com datas fixas.
// Quantidades em milésimos (inteiros) para não acumular erro de ponto flutuante.
// As regras reproduzem as fórmulas da planilha GESTOR DE CONTRATOS.

export const TIPOS = {
  ENTRADA: { efeito: 'consumo', sinal: 1 },
  'SOLICITAÇÃO': { efeito: 'consumo', sinal: 1 },
  'DEVOLUÇÃO': { efeito: 'consumo', sinal: -1 },
  'LOCAÇÃO': { efeito: 'locacao', sinal: 1 },
  'APLICAÇÃO': { efeito: 'aplicacao', sinal: 1 },
  RECOLHIMENTO: { efeito: 'aplicacao', sinal: -1 },
  REFATURA: { efeito: null }, // informativos: não mexem em nenhum saldo
  RECUSA: { efeito: null },
  'ENTREGA PARCELADA': { efeito: null },
};
export const TIPOS_LANCAVEIS = ['ENTRADA', 'SOLICITAÇÃO', 'DEVOLUÇÃO', 'LOCAÇÃO', 'APLICAÇÃO', 'RECOLHIMENTO', 'RECUSA', 'REFATURA', 'ENTREGA PARCELADA'];

// Limites por modalidade de aquisição: dias até o término OU fração de saldo restante.
export const REGRAS = {
  'Pregão': { pedidoDias: 105, pedidoSaldo: 0.2, reqDias: 210, reqSaldo: 0.3 },
  PV: { pedidoDias: 45, pedidoSaldo: 0.2, reqDias: 90, reqSaldo: 0.3 },
};
export const URGENTE_DIAS = 15;          // solicitação: "emitir nota fiscal urgente"
export const TERMINO_PROXIMO_DIAS = 210; // aviso "tempo de contrato próximo do término"

const DIA_MS = 86_400_000;
const MES_DIAS = 30.4375;

export const emMilesimos = (n) => Math.round(Number(n) * 1000);
export const deMilesimos = (m) => m / 1000;

export function hojeISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const utc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const diasEntre = (a, b) => Math.round((utc(b) - utc(a)) / DIA_MS);
export const somarDias = (iso, n) => new Date(utc(iso) + n * DIA_MS).toISOString().slice(0, 10);
export function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(utc(s));
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Soma os movimentos nos três saldos. `movs`: [{tipo, quantidade}] (milésimos). */
export function totais(movs) {
  const t = { consumo: 0, locacao: 0, aplicacao: 0 };
  for (const m of movs) {
    const e = TIPOS[m.tipo];
    if (e?.efeito) t[e.efeito] += e.sinal * m.quantidade;
  }
  return t;
}

/** O campo "novo processo" já aponta para um contrato/requisição em andamento? (regra da planilha) */
export function temNovoProcesso(c) {
  const np = String(c.novo_processo ?? '').trim();
  return Boolean(np) && np !== '-' && np !== '0';
}
function novoProcessoEmAndamento(c) {
  const np = String(c.novo_processo ?? '').trim();
  return temNovoProcesso(c) && (np === c.numero || /^(45|36|30)/.test(np));
}

/**
 * contrato: linha de `contratos` (quantidades em milésimos)
 * movs: movimentos do contrato · abertas: soma (milésimos) das solicitações em aberto
 */
export function metricas(c, movs, abertas, hoje) {
  const t = totais(movs);
  const qtd = c.qtd_contratada;
  const saldo = qtd - t.consumo;
  const saldoLocacao = c.qtd_locacao === null ? null : c.qtd_locacao - t.locacao;

  const diasTotal = Math.max(diasEntre(c.data_inicio, c.data_fim), 1);
  const iniciado = hoje >= c.data_inicio;
  const diasParaInicio = iniciado ? 0 : diasEntre(hoje, c.data_inicio);
  const diasDecorridos = iniciado ? Math.min(diasEntre(c.data_inicio, hoje), diasTotal) : 0;
  const diasRestantes = diasEntre(hoje, c.data_fim);
  const pctTempo = Math.min(100, (diasDecorridos / diasTotal) * 100);
  const pctConsumido = qtd > 0 ? (t.consumo / qtd) * 100 : 0;
  const pctSaldo = qtd > 0 ? Math.max(0, (saldo / qtd) * 100) : 0;

  // Planilha: "SEM CONTRATO" quando o término chegou ou o saldo zerou.
  const vencido = diasRestantes <= 0;
  const esgotado = saldo <= 0;
  const semContrato = vencido || esgotado;

  // Status de processo (coluna "STATUS DE PROCESSO" da planilha).
  // Diferença deliberada: saldo esgotado conta como "saldo baixo"; na planilha o texto
  // "SEM CONTRATO" deixava um contrato zerado com muito prazo aparecer como "-".
  let statusProcesso = '-';
  const regra = REGRAS[c.aquisicao];
  if (regra && !novoProcessoEmAndamento(c)) {
    if (diasRestantes <= regra.pedidoDias || pctSaldo / 100 <= regra.pedidoSaldo) statusProcesso = 'SOLICITAR PEDIDO';
    else if (diasRestantes <= regra.reqDias || pctSaldo / 100 <= regra.reqSaldo) statusProcesso = 'EMITIR NOVA REQ';
  }

  const meses = diasDecorridos / MES_DIAS;
  const consumoMedioMensal = meses >= 1 / MES_DIAS && t.consumo > 0 ? Math.round(t.consumo / meses) : null;
  const mesesRestantes = diasRestantes > 0 ? diasRestantes / MES_DIAS : 0;
  const necessarioMensal = saldo > 0 && mesesRestantes > 0 ? Math.round(saldo / mesesRestantes) : null;
  let diasParaEsgotar = null, dataEsgotamento = null, sobraNoFim = null;
  if (t.consumo > 0 && diasDecorridos > 0 && saldo > 0) {
    const porDia = t.consumo / diasDecorridos;
    diasParaEsgotar = Math.floor(saldo / porDia);
    dataEsgotamento = somarDias(hoje, diasParaEsgotar);
    if (!vencido) sobraNoFim = Math.round(saldo - porDia * diasRestantes);
  }

  const alertas = [];
  const add = (nivel, codigo, texto) => alertas.push({ nivel, codigo, texto });
  if (!iniciado) add('info', 'futuro', `Vigência começa em ${diasParaInicio} dia(s)`);
  if (iniciado && vencido) add('critico', 'vencido', diasRestantes === 0 ? 'Vigência termina hoje' : `Vigência encerrada há ${-diasRestantes} dia(s)`);
  else if (iniciado && diasRestantes <= TERMINO_PROXIMO_DIAS) add('atencao', 'termino_proximo', `Tempo de contrato próximo do término: ${diasRestantes} dia(s)`);
  if (saldo < 0) add('critico', 'excedido', 'Movimentos ultrapassam a quantidade contratada');
  else if (saldo === 0) add('critico', 'esgotado', 'Saldo esgotado');
  else if (qtd > 0 && pctSaldo <= 20) add('atencao', 'saldo_baixo', `Restam ${pctSaldo.toFixed(0)}% do saldo`);
  if (statusProcesso !== '-') add(statusProcesso === 'SOLICITAR PEDIDO' ? 'critico' : 'atencao', 'processo', statusProcesso === 'SOLICITAR PEDIDO' ? 'Solicitar pedido (novo processo)' : 'Emitir nova requisição');
  if (novoProcessoEmAndamento(c)) add('info', 'novo_processo', `Novo processo: ${c.novo_processo}`);
  if (iniciado && !vencido && saldo > 0 && diasParaEsgotar !== null && diasParaEsgotar < diasRestantes)
    add('atencao', 'ritmo_alto', `No ritmo atual o saldo acaba em ${diasParaEsgotar} dia(s), antes do fim da vigência`);

  const situacao = statusProcesso === 'SOLICITAR PEDIDO' ? 'critico'
    : statusProcesso === 'EMITIR NOVA REQ' ? 'atencao'
    : semContrato ? 'encerrado'
    : !iniciado ? 'futuro' : 'ok';

  const ultima = movs.reduce((m, x) => (TIPOS[x.tipo]?.efeito === 'consumo' && (!m || x.data > m) ? x.data : m), null);

  return {
    qtdContratada: qtd, consumido: t.consumo, saldo, pctConsumido, pctSaldo,
    saldoAplicacao: t.aplicacao, saldoLocacao,
    diasTotal, diasDecorridos, diasRestantes, diasParaInicio, iniciado, vencido, esgotado, semContrato, pctTempo,
    statusProcesso, novoProcesso: temNovoProcesso(c) ? String(c.novo_processo).trim() : '',
    emTramite: novoProcessoEmAndamento(c),
    solicitadoEmAberto: abertas, saldoAposAbertas: saldo - abertas,
    consumoMedioMensal, necessarioMensal, diasParaEsgotar, dataEsgotamento, sobraNoFim,
    qtdMovimentos: movs.length, ultimaEntrada: ultima,
    alertas, situacao,
  };
}
