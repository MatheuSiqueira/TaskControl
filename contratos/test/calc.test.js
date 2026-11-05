import test from 'node:test';
import assert from 'node:assert/strict';
import { metricas, totais, diasEntre, somarDias, dataValida, emMilesimos } from '../server/calc.js';

const q = emMilesimos;
const base = (o = {}) => ({ data_inicio: '2025-01-01', data_fim: '2030-01-01', qtd_contratada: q(3000), qtd_locacao: null, aquisicao: 'Pregão', numero: '4500067289', novo_processo: '', ...o });
const mv = (tipo, qtd, data = '2026-01-01') => ({ tipo, quantidade: q(qtd), data });

test('datas', () => {
  assert.equal(diasEntre('2026-01-01', '2026-03-01'), 59);
  assert.equal(somarDias('2026-02-27', 2), '2026-03-01');
  assert.ok(dataValida('2026-02-28') && !dataValida('2026-02-30') && !dataValida('28/02/2026'));
});

test('saldo = contratado − (ENTRADA + SOLICITAÇÃO − DEVOLUÇÃO); demais tipos não mexem nele', () => {
  const movs = [mv('ENTRADA', 500), mv('SOLICITAÇÃO', 100), mv('DEVOLUÇÃO', 40), mv('REFATURA', 500), mv('RECUSA', 120), mv('ENTREGA PARCELADA', 77)];
  assert.equal(totais(movs).consumo, q(560));
  assert.equal(metricas(base(), movs, 0, '2026-06-01').saldo, q(2440));
});

test('aplicação (cilindros em campo) e locação têm saldos próprios', () => {
  const movs = [mv('APLICAÇÃO', 30), mv('RECOLHIMENTO', 12), mv('LOCAÇÃO', 120), mv('LOCAÇÃO', 62)];
  const m = metricas(base({ qtd_locacao: q(720) }), movs, 0, '2026-06-01');
  assert.equal(m.saldoAplicacao, q(18));
  assert.equal(m.saldoLocacao, q(538));
  assert.equal(m.saldo, q(3000)); // locação/aplicação não consomem o saldo do contrato
});

test('dias do contrato correm sozinhos', () => {
  const a = metricas(base(), [], 0, '2026-07-01');
  const b = metricas(base(), [], 0, '2026-07-02');
  assert.equal(a.diasRestantes - b.diasRestantes, 1);
});

test('Acetileno Gasoso (dados da planilha): 82% de saldo, 598 dias → sem alerta', () => {
  const m = metricas(base({ data_inicio: '2023-06-23', data_fim: somarDias('2025-10-23', 598) }), [mv('ENTRADA', 536)], 0, '2025-10-23');
  assert.equal(m.saldo, q(2464));
  assert.equal(m.diasRestantes, 598);
  assert.equal(m.statusProcesso, '-');
});

test('Pregão: ≤105 dias ou ≤20% → SOLICITAR PEDIDO; ≤210 dias ou ≤30% → EMITIR NOVA REQ', () => {
  const c = base({ data_fim: '2026-12-31' });
  assert.equal(metricas(c, [], 0, '2026-09-17').statusProcesso, 'SOLICITAR PEDIDO'); // 105 dias
  assert.equal(metricas(c, [], 0, '2026-09-16').statusProcesso, 'EMITIR NOVA REQ');  // 106 dias
  assert.equal(metricas(c, [], 0, '2026-06-04').statusProcesso, 'EMITIR NOVA REQ');  // 210 dias
  assert.equal(metricas(c, [], 0, '2026-06-03').statusProcesso, '-');                // 211 dias
  const longo = base({ data_fim: '2035-01-01' });
  assert.equal(metricas(longo, [mv('ENTRADA', 2400)], 0, '2026-06-01').statusProcesso, 'SOLICITAR PEDIDO'); // saldo 20%
  assert.equal(metricas(longo, [mv('ENTRADA', 2100)], 0, '2026-06-01').statusProcesso, 'EMITIR NOVA REQ'); // saldo 30%
  assert.equal(metricas(longo, [mv('ENTRADA', 2000)], 0, '2026-06-01').statusProcesso, '-');                // saldo 33%
});

test('PV usa limites menores: 45 e 90 dias', () => {
  const c = base({ aquisicao: 'PV', data_fim: '2026-12-31' });
  assert.equal(metricas(c, [], 0, '2026-11-16').statusProcesso, 'SOLICITAR PEDIDO'); // 45 dias
  assert.equal(metricas(c, [], 0, '2026-10-02').statusProcesso, 'EMITIR NOVA REQ');  // 90 dias
  assert.equal(metricas(c, [], 0, '2026-10-01').statusProcesso, '-');                // 91 dias
});

test('novo processo já em andamento suspende o alerta; sem aquisição não há regra', () => {
  const perto = { data_fim: '2026-12-31' };
  assert.equal(metricas(base({ ...perto, novo_processo: '3600005190' }), [], 0, '2026-12-01').statusProcesso, '-');
  assert.equal(metricas(base({ ...perto, novo_processo: 'EM COTAÇÃO' }), [], 0, '2026-12-01').statusProcesso, 'SOLICITAR PEDIDO');
  assert.equal(metricas(base({ ...perto, aquisicao: '' }), [], 0, '2026-12-01').statusProcesso, '-');
});

test('saldo esgotado conta como saldo baixo (na planilha aparecia "-")', () => {
  const m = metricas(base(), [mv('ENTRADA', 3000)], 0, '2026-06-01'); // Cloreto de Sódio: saldo 0 e anos de prazo
  assert.ok(m.esgotado && m.semContrato);
  assert.equal(m.statusProcesso, 'SOLICITAR PEDIDO');
});

test('vencido, excedido e solicitações em aberto', () => {
  const v = metricas(base({ data_fim: '2026-05-31' }), [], 0, '2026-06-01');
  assert.ok(v.vencido && v.semContrato && v.diasRestantes === -1);
  const e = metricas(base(), [mv('ENTRADA', 3100)], 0, '2026-06-01');
  assert.equal(e.saldo, q(-100));
  assert.ok(e.alertas.some((a) => a.codigo === 'excedido'));
  const a = metricas(base(), [mv('ENTRADA', 1000)], q(500), '2026-06-01');
  assert.equal(a.saldoAposAbertas, q(1500));
});

test('quantidades fracionárias não acumulam erro de ponto flutuante', () => {
  const movs = Array.from({ length: 10 }, () => mv('ENTRADA', 0.1));
  assert.equal(metricas(base({ qtd_contratada: q(1) }), movs, 0, '2026-06-01').saldo, 0);
});
