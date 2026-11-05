import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { criarApp } from '../server/app.js';

async function subir(opts = {}) {
  const { app, fechar } = criarApp({ dbPath: ':memory:', hoje: () => '2026-07-01', ...opts });
  const srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, caminho, corpo, usuario = 'Ana') => {
    const raw = corpo instanceof Uint8Array;
    const r = await fetch(url + caminho, {
      method: metodo,
      headers: { 'content-type': raw ? 'application/octet-stream' : 'application/json', 'x-usuario': encodeURIComponent(usuario), ...(opts.codigoAcesso ? { 'x-codigo': opts.codigoAcesso } : {}) },
      body: corpo ? (raw ? corpo : JSON.stringify(corpo)) : undefined,
    });
    const txt = await r.text();
    return { status: r.status, corpo: txt && r.headers.get('content-type')?.includes('json') ? JSON.parse(txt) : txt };
  };
  return { chamar, url, parar: () => { srv.closeAllConnections(); srv.close(); fechar(); } };
}
const contrato = { produto: 'Acetileno Gasoso', codigo: '30168329', numero: '4500067289', fornecedor: 'WHITE MARTINS', unidade: 'KG',
  qtd_contratada: 3000, data_inicio: '2025-01-01', data_fim: '2027-06-23', aquisicao: 'Pregão', qtd_locacao: 720 };
const novo = async (s, extra = {}) => (await s.chamar('POST', '/api/contratos', { ...contrato, ...extra })).corpo;

test('fluxo: NF debita o saldo e o dashboard reflete', async () => {
  const s = await subir();
  try {
    const c = await novo(s);
    assert.equal(c.saldo, 3000);
    assert.equal(c.diasRestantes, 357); // 01/07/2026 → 23/06/2027
    const r = await s.chamar('POST', `/api/contratos/${c.id}/movimentos`, { tipo: 'ENTRADA', nf: '1234', quantidade: 22.5 });
    assert.equal(r.status, 201);
    const d = (await s.chamar('GET', '/api/dashboard')).corpo;
    assert.equal(d.contratos[0].saldo, 2977.5);
    assert.equal(d.resumo.vigentes, 1);
    assert.equal(d.recentes[0].produto, 'Acetileno Gasoso');
    // locação e aplicação não mexem no saldo do contrato
    await s.chamar('POST', `/api/contratos/${c.id}/movimentos`, { tipo: 'LOCAÇÃO', nf: '999', quantidade: 72 });
    await s.chamar('POST', `/api/contratos/${c.id}/movimentos`, { tipo: 'APLICAÇÃO', quantidade: 5 });
    const det = (await s.chamar('GET', `/api/contratos/${c.id}`)).corpo;
    assert.equal(det.saldo, 2977.5); assert.equal(det.saldoLocacao, 648); assert.equal(det.saldoAplicacao, 5);
  } finally { s.parar(); }
});

test('saldo insuficiente e NF repetida pedem confirmação', async () => {
  const s = await subir();
  try {
    const c = await novo(s);
    const r1 = await s.chamar('POST', `/api/contratos/${c.id}/movimentos`, { tipo: 'ENTRADA', nf: '1', quantidade: 3001 });
    assert.equal(r1.status, 409); assert.ok(r1.corpo.confirmacao[0].includes('insuficiente'));
    assert.equal((await s.chamar('POST', `/api/contratos/${c.id}/movimentos`, { tipo: 'ENTRADA', nf: '1', quantidade: 3001, confirmar: true })).status, 201);
    assert.equal((await s.chamar('GET', `/api/contratos/${c.id}`)).corpo.saldo, -1);
    await s.chamar('POST', `/api/contratos/${c.id}/movimentos`, { tipo: 'DEVOLUÇÃO', nf: '2', quantidade: 10 });
    const dup = await s.chamar('POST', `/api/contratos/${c.id}/movimentos`, { tipo: 'DEVOLUÇÃO', nf: '2', quantidade: 1 });
    assert.equal(dup.status, 409); assert.ok(dup.corpo.confirmacao[0].includes('já foi lançada'));
  } finally { s.parar(); }
});

test('uso simultâneo: lançamentos paralelos não se perdem nem furam o saldo', async () => {
  const s = await subir();
  try {
    const c = await novo(s, { qtd_contratada: 1000 });
    const resp = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      s.chamar('POST', `/api/contratos/${c.id}/movimentos`, { tipo: 'ENTRADA', nf: `NF${i}`, quantidade: 100 }, `Usuario${i % 4}`)));
    assert.equal(resp.filter((r) => r.status === 201).length, 10);
    assert.equal(resp.filter((r) => r.status === 409 && r.corpo.confirmacao).length, 10);
    const det = (await s.chamar('GET', `/api/contratos/${c.id}`)).corpo;
    assert.equal(det.saldo, 0); assert.equal(det.qtdMovimentos, 10);
  } finally { s.parar(); }
});

test('edição concorrente é detectada (contrato e lançamento)', async () => {
  const s = await subir();
  try {
    const c = await novo(s);
    const a = await s.chamar('PUT', `/api/contratos/${c.id}`, { ...contrato, fornecedor: 'Ana mudou', versao: c.versao }, 'Ana');
    assert.equal(a.status, 200);
    const b = await s.chamar('PUT', `/api/contratos/${c.id}`, { ...contrato, fornecedor: 'Bia mudou', versao: c.versao }, 'Bia');
    assert.equal(b.status, 409); assert.match(b.corpo.erro, /Ana/);
    const m = (await s.chamar('POST', `/api/contratos/${c.id}/movimentos`, { tipo: 'ENTRADA', nf: '7', quantidade: 5 })).corpo;
    assert.equal((await s.chamar('PUT', `/api/movimentos/${m.id}`, { tipo: 'ENTRADA', nf: '7', quantidade: 6, versao: m.versao })).status, 200);
    assert.equal((await s.chamar('PUT', `/api/movimentos/${m.id}`, { tipo: 'ENTRADA', nf: '7', quantidade: 9, versao: m.versao })).status, 409);
  } finally { s.parar(); }
});

test('solicitação: valida fornecedor, contrato encerrado, último fornecimento; atender fecha a solicitação', async () => {
  const s = await subir();
  try {
    const a = await novo(s);
    const b = await novo(s, { produto: 'Ar Sintético', numero: '2', fornecedor: 'AIR LIQUIDE', qtd_contratada: 100 });
    const enc = await novo(s, { produto: 'Velho', numero: '3', data_inicio: '2020-01-01', data_fim: '2026-06-30' });
    const pedido = (itens, extra = {}) => s.chamar('POST', '/api/solicitacoes', { itens, ...extra });
    assert.equal((await pedido([{ contrato_id: a.id, quantidade: 10 }, { contrato_id: b.id, quantidade: 5 }])).status, 400); // fornecedores diferentes
    assert.equal((await pedido([{ contrato_id: enc.id, quantidade: 10 }])).status, 409);                                       // encerrado
    const ult = await pedido([{ contrato_id: b.id, quantidade: 100 }]);
    assert.equal(ult.status, 409); assert.ok(ult.corpo.confirmacao[0].includes('ÚLTIMO FORNECIMENTO'));
    const ok = await pedido([{ contrato_id: a.id, quantidade: 200, observacao: 'urgente' }, { contrato_id: novo && a.id, quantidade: 50, modalidade: 'RECOLHIMENTO' }], { confirmar: true });
    assert.equal(ok.status, 201);
    const lote = (await s.chamar('GET', `/api/solicitacoes/lote/${ok.corpo.lote}`)).corpo;
    assert.equal(lote.itens.length, 2); assert.equal(lote.fornecedor, 'WHITE MARTINS');
    const d = (await s.chamar('GET', '/api/dashboard')).corpo;
    assert.equal(d.resumo.solicitacoesAbertas, 2);
    assert.equal(d.contratos.find((x) => x.id === a.id).saldoAposAbertas, 2800); // recolhimento não reserva saldo
    // lançar a NF a partir da solicitação a encerra
    const item = lote.itens.find((i) => i.modalidade === 'ENTREGA PARCELADA');
    await s.chamar('POST', `/api/contratos/${a.id}/movimentos`, { tipo: 'ENTRADA', nf: '55', quantidade: 200, solicitacao_id: item.id });
    assert.equal((await s.chamar('GET', '/api/dashboard')).corpo.resumo.solicitacoesAbertas, 1);
  } finally { s.parar(); }
});

test('validações, exclusão protegida, CSV e código de acesso', async () => {
  const s = await subir();
  try {
    assert.equal((await s.chamar('POST', '/api/contratos', { ...contrato, data_fim: '2024-01-01' })).status, 400);
    assert.equal((await s.chamar('POST', '/api/contratos', { ...contrato, qtd_contratada: 'abc' })).status, 400);
    assert.equal((await s.chamar('POST', '/api/contratos', { ...contrato, aquisicao: 'Dispensa' })).status, 400);
    const c = await novo(s);
    assert.equal((await s.chamar('POST', '/api/contratos', contrato)).status, 409);
    await s.chamar('POST', `/api/contratos/${c.id}/movimentos`, { tipo: 'ENTRADA', nf: '=CMD()', quantidade: 10 });
    assert.equal((await s.chamar('DELETE', `/api/contratos/${c.id}`)).status, 409);
    assert.match((await s.chamar('GET', '/api/exportar/movimentos.csv')).corpo, /'=CMD\(\)/);
    const det = (await s.chamar('GET', `/api/contratos/${c.id}`)).corpo;
    assert.ok(det.historico[0].usuario === 'Ana');
  } finally { s.parar(); }
  const p = await subir({ codigoAcesso: 'segredo' });
  try {
    assert.equal((await fetch(p.url + '/api/dashboard')).status, 401);
    assert.equal((await p.chamar('GET', '/api/dashboard')).status, 200);
  } finally { p.parar(); }
});

// Planilha mínima no formato real (números como texto, datas serial e dd/mm/aaaa, aba de movimentos, marcador "*").
function planilhaFalsa() {
  const sst = ['PRODUTO', 'Teste Gás', 'KG', 'FORNECEDOR X', 'Pregão', 'ENTRADA', 'LOCAÇÃO', '300', '29/08/2025', '45000', '50'];
  const c = (r, v, t) => `<c r="${r}"${t ? ` t="${t}"` : ''}><v>${v}</v></c>`;
  const gestor = `<worksheet><sheetData><row r="2">${c('A2', 1, 's')}${c('B2', 777, '')}${c('C2', 7, 's')}${c('D2', 2, 's')}${c('E2', 250)}${c('G2', 8, 's')}${c('H2', 46929)}${c('J2', 3, 's')}${c('K2', 4500001)}${c('P2', 100)}${c('S2', 4, 's')}</row></sheetData></worksheet>`;
  const aba = `<worksheet><sheetData><row r="16">${c('A16', 1, 's')}</row>
    <row r="19">${c('A19', 5, 's')}${c('C19', 45700)}${c('E19', 11)}${c('G19', 10, 's')}</row>
    <row r="20">${c('A20', 5, 's')}${c('C20', 45701)}${c('E20', 12)}${c('G20', 0)}</row>
    <row r="21">${c('A21', 6, 's')}${c('C21', 45702)}${c('E21', 13)}${c('G21', 30)}</row>
    <row r="22">${c('A22', 0, 's')}</row><row r="1001">${c('A1001', 0, 's')}</row></sheetData></worksheet>`.replace('<c r="A22" t="s"><v>0</v></c>', '<c r="A22" t="inlineStr"><is><t>*</t></is></c>');
  const arq = {
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="GESTOR DE CONTRATOS" sheetId="1" r:id="rId1"/><sheet name="Teste Gás" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8(`<sst>${sst.map((x) => `<si><t>${x}</t></si>`).join('')}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(gestor), 'xl/worksheets/sheet2.xml': strToU8(aba),
  };
  return zipSync(arq);
}

test('importação da planilha: lê números como texto, confere saldos e protege dados existentes', async () => {
  const s = await subir();
  try {
    const r = await s.chamar('POST', '/api/importar', planilhaFalsa());
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.contratos, 1);
    assert.equal(r.corpo.movimentos, 2); // a linha com quantidade 0 é descartada e avisada
    assert.equal(r.corpo.avisos.length, 1);
    assert.deepEqual(r.corpo.divergencias, []); // saldo da planilha (250) = 300 − 50 do sistema
    const c = (await s.chamar('GET', '/api/contratos')).corpo[0];
    assert.equal(c.produto, 'Teste Gás'); assert.equal(c.qtdContratada, 300); assert.equal(c.saldo, 250); assert.equal(c.saldoLocacao, 70);
    assert.equal(c.data_inicio, '2025-08-29'); assert.equal(c.aquisicao, 'Pregão');
    const de_novo = await s.chamar('POST', '/api/importar', planilhaFalsa());
    assert.equal(de_novo.status, 409); assert.equal(de_novo.corpo.jaTemDados, true);
    assert.equal((await s.chamar('POST', '/api/importar?substituir=1', planilhaFalsa())).status, 200);
    assert.equal((await s.chamar('GET', '/api/contratos')).corpo.length, 1);
    assert.equal((await s.chamar('POST', '/api/importar?substituir=1', new Uint8Array([1, 2, 3]))).status, 400);
    assert.equal((await s.chamar('GET', '/api/contratos')).corpo.length, 1); // arquivo inválido não apaga nada
  } finally { s.parar(); }
});
