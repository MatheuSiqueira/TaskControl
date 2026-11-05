// Regras de negócio puras: nada aqui toca disco ou rede, então dá para testar com datas fixas.
// Valores em centavos (inteiros) para não acumular erro de ponto flutuante.

export const LIMITES = {
  vigenciaCriticoDias: 30,
  vigenciaAtencaoDias: 90,
  saldoCriticoPct: 10,
  saldoAtencaoPct: 25,
  esgotaCriticoDias: 30,
};

const DIA_MS = 86_400_000;
const MES_DIAS = 30.4375;

export function hojeISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function utc(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function diasEntre(a, b) {
  return Math.round((utc(b) - utc(a)) / DIA_MS);
}

export function somarDias(iso, n) {
  const d = new Date(utc(iso) + n * DIA_MS);
  return d.toISOString().slice(0, 10);
}

export function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(utc(s));
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * contrato:  { data_inicio, data_fim, valor_inicial }
 * aditivos:  [{ valor_delta, nova_data_fim }]
 * notas:     [{ valor, data_entrada }]
 * Tudo que "corre sozinho" (dias, ritmo, alertas) é calculado aqui a partir de `hoje`.
 */
export function metricas(contrato, aditivos, notas, hoje) {
  const total = contrato.valor_inicial + aditivos.reduce((s, a) => s + (a.valor_delta || 0), 0);
  const consumido = notas.reduce((s, n) => s + n.valor, 0);
  const saldo = total - consumido;

  let dataFim = contrato.data_fim;
  for (const a of aditivos) if (a.nova_data_fim && a.nova_data_fim > dataFim) dataFim = a.nova_data_fim;

  const diasTotal = Math.max(diasEntre(contrato.data_inicio, dataFim), 1);
  const iniciado = hoje >= contrato.data_inicio;
  const diasParaInicio = iniciado ? 0 : diasEntre(hoje, contrato.data_inicio);
  const diasDecorridos = iniciado ? Math.min(diasEntre(contrato.data_inicio, hoje), diasTotal) : 0;
  const diasRestantes = diasEntre(hoje, dataFim); // negativo = vencido
  const vencido = diasRestantes < 0;
  const pctTempo = Math.min(100, (diasDecorridos / diasTotal) * 100);
  const pctConsumido = total > 0 ? (consumido / total) * 100 : consumido > 0 ? 100 : 0;
  const pctSaldo = total > 0 ? Math.max(0, (saldo / total) * 100) : 0;

  const meses = diasDecorridos / MES_DIAS;
  const consumoMedioMensal = meses >= 1 / MES_DIAS && consumido > 0 ? Math.round(consumido / meses) : null;
  const mesesRestantes = diasRestantes > 0 ? diasRestantes / MES_DIAS : 0;
  const necessarioMensal = saldo > 0 && mesesRestantes > 0 ? Math.round(saldo / mesesRestantes) : null;

  // Projeção: mantido o ritmo médio diário até hoje, quando o saldo acaba?
  let diasParaEsgotar = null;
  let dataEsgotamento = null;
  let sobraNoFim = null;
  if (consumido > 0 && diasDecorridos > 0 && saldo > 0) {
    const porDia = consumido / diasDecorridos;
    diasParaEsgotar = Math.floor(saldo / porDia);
    dataEsgotamento = somarDias(hoje, diasParaEsgotar);
    if (!vencido) sobraNoFim = Math.round(saldo - porDia * diasRestantes);
  }

  const alertas = [];
  const add = (nivel, codigo, texto) => alertas.push({ nivel, codigo, texto });

  if (!iniciado) {
    add('info', 'futuro', `Começa em ${diasParaInicio} dia(s)`);
  } else if (vencido) {
    add('critico', 'vencido', `Vigência encerrada há ${-diasRestantes} dia(s)`);
  } else if (diasRestantes <= LIMITES.vigenciaCriticoDias) {
    add('critico', 'vence_logo', `Vence em ${diasRestantes} dia(s)`);
  } else if (diasRestantes <= LIMITES.vigenciaAtencaoDias) {
    add('atencao', 'vence_breve', `Vence em ${diasRestantes} dias`);
  }

  if (saldo < 0) {
    add('critico', 'excedido', 'Notas lançadas ultrapassam o valor do contrato');
  } else if (saldo === 0 && total > 0) {
    add('critico', 'esgotado', 'Saldo esgotado');
  } else if (total > 0 && pctSaldo <= LIMITES.saldoCriticoPct) {
    add('critico', 'saldo_baixo', `Restam só ${pctSaldo.toFixed(0)}% do saldo`);
  } else if (total > 0 && pctSaldo <= LIMITES.saldoAtencaoPct) {
    add('atencao', 'saldo_baixo', `Restam ${pctSaldo.toFixed(0)}% do saldo`);
  }

  if (iniciado && !vencido && saldo > 0 && diasParaEsgotar !== null && diasParaEsgotar < diasRestantes) {
    const nivel = diasParaEsgotar <= LIMITES.esgotaCriticoDias ? 'critico' : 'atencao';
    add(nivel, 'ritmo_alto', `No ritmo atual o saldo acaba em ${diasParaEsgotar} dia(s), antes do fim da vigência`);
  }
  if (iniciado && !vencido && saldo > 0 && diasRestantes <= LIMITES.vigenciaAtencaoDias && pctTempo - pctConsumido >= 30) {
    add('atencao', 'ritmo_baixo', `Só ${pctConsumido.toFixed(0)}% consumido com ${pctTempo.toFixed(0)}% do prazo corrido: risco de sobrar saldo`);
  }

  const ordem = { critico: 3, atencao: 2, info: 1 };
  const pior = alertas.reduce((m, a) => Math.max(m, ordem[a.nivel]), 0);
  const situacao = pior === 3 ? 'critico' : pior === 2 ? 'atencao' : !iniciado ? 'futuro' : 'ok';

  const ultima = notas.reduce((m, n) => (!m || n.data_entrada > m ? n.data_entrada : m), null);

  return {
    total, consumido, saldo, pctConsumido, pctSaldo,
    dataFim, diasTotal, diasDecorridos, diasRestantes, diasParaInicio,
    iniciado, vencido, pctTempo,
    consumoMedioMensal, necessarioMensal, diasParaEsgotar, dataEsgotamento, sobraNoFim,
    qtdNotas: notas.length, ultimaEntrada: ultima,
    alertas, situacao,
  };
}
