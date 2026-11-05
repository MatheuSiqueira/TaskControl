import test from 'node:test';
import assert from 'node:assert/strict';
import { criarApp } from '../server/app.js';

async function subir(opts = {}) {
  const { app, fechar } = criarApp({ dbPath: ':memory:', hoje: () => '2026-07-01', ...opts });
  const srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, caminho, corpo, usuario = 'Ana') => {
    const r = await fetch(url + caminho, {
      method: metodo,
      headers: { 'content-type': 'application/json', 'x-usuario': encodeURIComponent(usuario), ...(opts.codigoAcesso ? { 'x-codigo': opts.codigoAcesso } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const txt = await r.text();
    return { status: r.status, corpo: txt && r.headers.get('content-type')?.includes('json') ? JSON.parse(txt) : txt };
  };
  return { chamar, url, parar: () => { srv.closeAllConnections(); srv.close(); fechar(); } };
}
const contrato = { numero: '001/2026', fornecedor: 'Fornecedor X', objeto: 'Cimento', data_inicio: '2026-01-01', data_fim: '2026-12-31', valor_inicial: 100000 };

test('fluxo: contrato, notas debitam o saldo, dashboard reflete', async () => {
  const s = await subir();
  try {
    const c = await s.chamar('POST', '/api/contratos', contrato);
    assert.equal(c.status, 201);
    assert.equal(c.corpo.saldo, 100000);
    assert.equal(c.corpo.diasRestantes, 183);

    const n = await s.chamar('POST', `/api/contratos/${c.corpo.id}/notas`, { numero: '1234', data_entrada: '2026-06-30', valor: 12500.5 });
    assert.equal(n.status, 201);
    const d = await s.chamar('GET', '/api/dashboard');
    assert.equal(d.corpo.contratos[0].saldo, 87499.5);
    assert.equal(d.corpo.resumo.saldoVigente, 87499.5);
    assert.equal(d.corpo.recentes[0].contrato_numero, '001/2026');

    const dup = await s.chamar('POST', `/api/contratos/${c.corpo.id}/notas`, { numero: '1234', valor: 10 });
    assert.equal(dup.status, 409);
  } finally { s.parar(); }
});

test('nota acima do saldo exige confirmação', async () => {
  const s = await subir();
  try {
    const c = (await s.chamar('POST', '/api/contratos', contrato)).corpo;
    const r1 = await s.chamar('POST', `/api/contratos/${c.id}/notas`, { numero: '1', valor: 100001 });
    assert.equal(r1.status, 409);
    assert.equal(r1.corpo.excedeSaldo, true);
    const r2 = await s.chamar('POST', `/api/contratos/${c.id}/notas`, { numero: '1', valor: 100001, confirmarExcesso: true });
    assert.equal(r2.status, 201);
    const det = (await s.chamar('GET', `/api/contratos/${c.id}`)).corpo;
    assert.equal(det.saldo, -1);
    assert.ok(det.alertas.some((a) => a.codigo === 'excedido'));
  } finally { s.parar(); }
});

test('uso simultâneo: lançamentos paralelos não se perdem nem furam o saldo', async () => {
  const s = await subir();
  try {
    const c = (await s.chamar('POST', '/api/contratos', { ...contrato, valor_inicial: 1000 })).corpo;
    const resp = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      s.chamar('POST', `/api/contratos/${c.id}/notas`, { numero: `NF${i}`, valor: 100 }, `Usuario${i % 4}`)));
    const ok = resp.filter((r) => r.status === 201).length;
    const barradas = resp.filter((r) => r.status === 409 && r.corpo.excedeSaldo).length;
    assert.equal(ok, 10);          // só cabem 10 notas de 100 em 1000
    assert.equal(barradas, 10);
    const det = (await s.chamar('GET', `/api/contratos/${c.id}`)).corpo;
    assert.equal(det.saldo, 0);
    assert.equal(det.qtdNotas, 10);
  } finally { s.parar(); }
});

test('edição concorrente de contrato é detectada', async () => {
  const s = await subir();
  try {
    const c = (await s.chamar('POST', '/api/contratos', contrato)).corpo;
    const a = await s.chamar('PUT', `/api/contratos/${c.id}`, { ...contrato, fornecedor: 'Ana mudou', versao: c.versao }, 'Ana');
    assert.equal(a.status, 200);
    const b = await s.chamar('PUT', `/api/contratos/${c.id}`, { ...contrato, fornecedor: 'Bia mudou', versao: c.versao }, 'Bia');
    assert.equal(b.status, 409);
    assert.match(b.corpo.erro, /Ana/);
  } finally { s.parar(); }
});

test('aditivo estende prazo e valor; não deixa saldo negativo', async () => {
  const s = await subir();
  try {
    const c = (await s.chamar('POST', '/api/contratos', contrato)).corpo;
    await s.chamar('POST', `/api/contratos/${c.id}/notas`, { numero: '1', valor: 90000 });
    const ad = await s.chamar('POST', `/api/contratos/${c.id}/aditivos`, { valor_delta: 50000, nova_data_fim: '2027-06-30', descricao: '1º termo' });
    assert.equal(ad.status, 201);
    const det = (await s.chamar('GET', `/api/contratos/${c.id}`)).corpo;
    assert.equal(det.total, 150000);
    assert.equal(det.saldo, 60000);
    assert.equal(det.dataFim, '2027-06-30');
    const neg = await s.chamar('POST', `/api/contratos/${c.id}/aditivos`, { valor_delta: -70000 });
    assert.equal(neg.status, 400);
    await s.chamar('POST', `/api/contratos/${c.id}/notas`, { numero: '2', valor: 40000 }); // consumido 130.000 > 100.000 originais
    const rem = await s.chamar('DELETE', `/api/aditivos/${ad.corpo.id}`);
    assert.equal(rem.status, 409);
  } finally { s.parar(); }
});

test('validações, exclusão protegida e CSV', async () => {
  const s = await subir();
  try {
    assert.equal((await s.chamar('POST', '/api/contratos', { ...contrato, data_fim: '2025-01-01' })).status, 400);
    assert.equal((await s.chamar('POST', '/api/contratos', { ...contrato, valor_inicial: 'abc' })).status, 400);
    const c = (await s.chamar('POST', '/api/contratos', contrato)).corpo;
    assert.equal((await s.chamar('POST', '/api/contratos', contrato)).status, 409);
    await s.chamar('POST', `/api/contratos/${c.id}/notas`, { numero: '=CMD()', valor: 10 });
    assert.equal((await s.chamar('DELETE', `/api/contratos/${c.id}`)).status, 409);
    const csv = await s.chamar('GET', '/api/exportar/notas.csv');
    assert.match(csv.corpo, /'=CMD\(\)/);
    const det = (await s.chamar('GET', `/api/contratos/${c.id}`)).corpo;
    assert.ok(det.historico.length >= 2 && det.historico[0].usuario === 'Ana');
  } finally { s.parar(); }
});

test('código de acesso protege a API', async () => {
  const s = await subir({ codigoAcesso: 'segredo' });
  try {
    assert.equal((await fetch(s.url + '/api/dashboard')).status, 401);
    assert.equal((await s.chamar('GET', '/api/dashboard')).status, 200);
    assert.equal((await fetch(s.url + '/api/saude')).status, 200);
  } finally { s.parar(); }
});
