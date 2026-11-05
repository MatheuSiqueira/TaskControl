import test from 'node:test';
import assert from 'node:assert/strict';
import { metricas, diasEntre, somarDias, dataValida } from '../server/calc.js';

const base = { data_inicio: '2026-01-01', data_fim: '2026-12-31', valor_inicial: 1_000_000_00 };

test('datas', () => {
  assert.equal(diasEntre('2026-01-01', '2026-03-01'), 59);
  assert.equal(somarDias('2026-02-27', 2), '2026-03-01');
  assert.ok(dataValida('2026-02-28'));
  assert.ok(!dataValida('2026-02-30'));
  assert.ok(!dataValida('28/02/2026'));
});

test('saldo debita pelas notas e o prazo corre com os dias', () => {
  const notas = [{ valor: 200_000_00, data_entrada: '2026-02-10' }, { valor: 50_000_00, data_entrada: '2026-03-01' }];
  const a = metricas(base, [], notas, '2026-07-01');
  assert.equal(a.consumido, 250_000_00);
  assert.equal(a.saldo, 750_000_00);
  assert.equal(a.diasRestantes, 183);
  const b = metricas(base, [], notas, '2026-07-02');
  assert.equal(b.diasRestantes, 182); // um dia depois, sem nenhuma nota nova
  assert.equal(b.saldo, a.saldo);
});

test('aditivos somam valor e estendem a vigência', () => {
  const m = metricas(base, [{ valor_delta: 250_000_00, nova_data_fim: '2027-06-30' }, { valor_delta: -50_000_00, nova_data_fim: null }], [], '2026-07-01');
  assert.equal(m.total, 1_200_000_00);
  assert.equal(m.dataFim, '2027-06-30');
});

test('alertas de vigência', () => {
  assert.equal(metricas(base, [], [], '2026-12-15').situacao, 'critico');
  assert.equal(metricas(base, [], [], '2026-11-01').situacao, 'atencao');
  const v = metricas(base, [], [], '2027-01-05');
  assert.ok(v.vencido && v.diasRestantes === -5 && v.situacao === 'critico');
  const f = metricas(base, [], [], '2025-12-20');
  assert.equal(f.situacao, 'futuro');
});

test('alertas de saldo e ritmo', () => {
  const quase = metricas(base, [], [{ valor: 920_000_00, data_entrada: '2026-05-01' }], '2026-06-01');
  assert.ok(quase.alertas.some((a) => a.codigo === 'saldo_baixo' && a.nivel === 'critico'));
  const rapido = metricas(base, [], [{ valor: 600_000_00, data_entrada: '2026-02-01' }], '2026-03-01'); // 60% em ~16% do prazo
  assert.ok(rapido.alertas.some((a) => a.codigo === 'ritmo_alto'));
  assert.ok(rapido.diasParaEsgotar < rapido.diasRestantes);
  const lento = metricas(base, [], [{ valor: 100_000_00, data_entrada: '2026-02-01' }], '2026-10-15');
  assert.ok(lento.alertas.some((a) => a.codigo === 'ritmo_baixo'));
});

test('saldo excedido e esgotado', () => {
  assert.ok(metricas(base, [], [{ valor: 1_100_000_00 }], '2026-06-01').alertas.some((a) => a.codigo === 'excedido'));
  assert.ok(metricas(base, [], [{ valor: 1_000_000_00 }], '2026-06-01').alertas.some((a) => a.codigo === 'esgotado'));
});

test('soma em centavos não acumula erro de ponto flutuante', () => {
  const notas = Array.from({ length: 10 }, () => ({ valor: 10 })); // dez notas de R$ 0,10
  assert.equal(metricas({ ...base, valor_inicial: 100 }, [], notas, '2026-06-01').saldo, 0);
});
