// Interface sem build: ES modules direto no navegador/Electron.
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');

// ---------- utilidades ----------
class Seguro { constructor(s) { this.s = s; } toString() { return this.s; } }
const bruto = (s) => new Seguro(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Todo valor interpolado é escapado, a menos que venha de bruto()/html().
const html = (partes, ...vals) => bruto(partes.reduce((a, p, i) => a + p + (i < vals.length ? [].concat(vals[i]).map((v) => (v instanceof Seguro ? v.s : esc(v))).join('') : ''), ''));
const num = (n, max = 3) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: max }));
const brl = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const pct = (n) => `${Math.round(n)}%`;
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const dias = (n) => `${n} dia${Math.abs(n) === 1 ? '' : 's'}`;
const hojeISO = () => new Date().toLocaleDateString('sv-SE');
const TIPOS = ['ENTRADA', 'SOLICITAÇÃO', 'DEVOLUÇÃO', 'LOCAÇÃO', 'APLICAÇÃO', 'RECOLHIMENTO', 'RECUSA', 'REFATURA', 'ENTREGA PARCELADA'];
const MODALIDADES = ['ENTREGA PARCELADA', 'RECOLHIMENTO', 'ENTREGA ÚNICA'];
const SITUACAO = { critico: 'Crítico', atencao: 'Atenção', encerrado: 'Sem contrato', ok: 'Em dia', futuro: 'A iniciar' };

let usuario = localStorage.getItem('usuario') || '';
let codigo = sessionStorage.getItem('codigo') || '';

async function api(metodo, url, corpo, { bruto: raw = false } = {}) {
  const r = await fetch(url, {
    method: metodo,
    headers: { 'content-type': raw ? 'application/octet-stream' : 'application/json', 'x-usuario': encodeURIComponent(usuario), 'x-codigo': codigo },
    body: corpo === undefined ? undefined : raw ? corpo : JSON.stringify(corpo),
  });
  if (r.status === 401) { await pedirCodigo(); return api(metodo, url, corpo, { bruto: raw }); }
  if (r.status === 204) return null;
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(dados.erro || `Erro ${r.status}`), dados, { status: r.status });
  return dados;
}
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 5000);
}

// ---------- modal ----------
function abrirModal(conteudo, aoMontar, { largo = false } = {}) {
  $('#modal').className = largo ? 'largo' : '';
  $('#modal').innerHTML = conteudo.toString();
  $('#modal-fundo').hidden = false;
  aoMontar?.($('#modal'));
  $('#modal input:not([type=hidden]), #modal textarea')?.focus();
}
const fecharModal = () => { $('#modal-fundo').hidden = true; $('#modal').innerHTML = ''; delete $('#modal').dataset.fixo; };
$('#modal-fundo').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-fundo' && !$('#modal').dataset.fixo) fecharModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').dataset.fixo) fecharModal(); });

function confirmar(msg, rotulo = 'Confirmar', perigo = false) {
  return new Promise((ok) => {
    abrirModal(html`<h2>${msg}</h2><div class="rodape-modal"><button class="btn sec" data-n>Cancelar</button><button class="btn ${perigo ? 'perigo' : ''}" data-s>${rotulo}</button></div>`, (m) => {
      m.querySelector('[data-n]').onclick = () => { fecharModal(); ok(false); };
      m.querySelector('[data-s]').onclick = () => { fecharModal(); ok(true); };
    });
  });
}
function pedirTexto({ titulo, rotulo, valor = '', tipo = 'text' }) {
  return new Promise((ok) => {
    abrirModal(html`<form><h2>${titulo}</h2><label>${rotulo}<input name="v" type="${tipo}" value="${valor}" required autocomplete="off"></label>
      <div class="rodape-modal"><button class="btn">OK</button></div></form>`, (m) => {
      m.dataset.fixo = '1';
      m.querySelector('form').onsubmit = (e) => { e.preventDefault(); const v = new FormData(e.target).get('v').trim(); if (!v) return; fecharModal(); ok(v); };
    });
  });
}
async function pedirCodigo() {
  codigo = await pedirTexto({ titulo: 'Código de acesso', rotulo: 'Peça o código ao administrador do servidor', tipo: 'password' });
  sessionStorage.setItem('codigo', codigo);
}
async function pedirUsuario() {
  usuario = await pedirTexto({ titulo: 'Quem está usando?', rotulo: 'Seu nome (aparece no histórico das alterações)', valor: usuario });
  localStorage.setItem('usuario', usuario);
  $('#usuario').textContent = `👤 ${usuario}`;
}

// Mostra, dentro do próprio formulário, as perguntas do servidor (saldo insuficiente etc.) e só grava se o usuário insistir.
function avisoConfirmacao(m, lista) {
  m.querySelector('#erro').innerHTML = `<div class="aviso"><strong>Confirme antes de gravar:</strong><ul>${lista.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>`;
}

// ---------- formulários ----------
function formulario({ titulo, campos, valores = {}, enviar, rotulo = 'Salvar', largo = false }) {
  const campo = (c) => {
    const v = valores[c.nome] ?? c.padrao ?? '';
    if (c.tipo === 'textarea') return html`<label>${c.rotulo}<textarea name="${c.nome}" rows="3">${v}</textarea></label>`;
    if (c.tipo === 'select') return html`<label>${c.rotulo}<select name="${c.nome}">${c.opcoes.map((o) => html`<option value="${o.v ?? o}" ${(o.v ?? o) === v ? 'selected' : ''}>${o.t ?? o}</option>`)}</select></label>`;
    if (c.tipo === 'check') return html`<label class="check"><input type="checkbox" name="${c.nome}" ${v ? 'checked' : ''}> ${c.rotulo}</label>`;
    return html`<label>${c.rotulo}<input name="${c.nome}" type="${c.tipo === 'number' ? 'text' : c.tipo || 'text'}" ${c.tipo === 'number' ? bruto('inputmode="decimal"') : ''} value="${v}" ${c.obrigatorio ? 'required' : ''} autocomplete="off"></label>`;
  };
  const grupos = [];
  for (const c of campos) (c.par && grupos.length ? grupos[grupos.length - 1].push(c) : grupos.push([c]));
  abrirModal(html`<form><h2>${titulo}</h2><div id="erro"></div>
    ${grupos.map((g) => g.length > 1 ? html`<div class="campos2" style="grid-template-columns:repeat(${g.length},1fr)">${g.map(campo)}</div>` : campo(g[0]))}
    <div class="rodape-modal"><button type="button" class="btn sec" data-c>Cancelar</button><button class="btn" id="ok">${rotulo}</button></div></form>`, (m) => {
    let confirmado = false;
    m.querySelector('[data-c]').onclick = fecharModal;
    m.querySelectorAll('input, select, textarea').forEach((el) => el.addEventListener('input', () => { confirmado = false; m.querySelector('#ok').textContent = rotulo; }));
    m.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const corpo = {};
      for (const c of campos) { const el = m.querySelector(`[name=${c.nome}]`); corpo[c.nome] = c.tipo === 'check' ? el.checked : el.value; }
      const btn = m.querySelector('#ok'); btn.disabled = true;
      try { await enviar(corpo, confirmado); fecharModal(); }
      catch (err) {
        if (err.confirmacao) { avisoConfirmacao(m, err.confirmacao); confirmado = true; btn.textContent = 'Confirmar mesmo assim'; }
        else m.querySelector('#erro').innerHTML = `<div class="erro">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
    };
  }, { largo });
}

const camposContrato = [
  { nome: 'produto', rotulo: 'Produto', obrigatorio: true },
  { nome: 'codigo', rotulo: 'Código do material', par: true },
  { nome: 'numero', rotulo: 'Nº do contrato', obrigatorio: true },
  { nome: 'fornecedor', rotulo: 'Fornecedor', obrigatorio: true, par: true },
  { nome: 'qtd_contratada', rotulo: 'Quantidade contratada', tipo: 'number', obrigatorio: true },
  { nome: 'unidade', rotulo: 'Unidade (KG, M³, LT…)', obrigatorio: true, par: true },
  { nome: 'data_inicio', rotulo: 'Início da vigência', tipo: 'date', obrigatorio: true },
  { nome: 'data_fim', rotulo: 'Término da vigência', tipo: 'date', obrigatorio: true, par: true },
  { nome: 'aquisicao', rotulo: 'Aquisição', tipo: 'select', opcoes: [{ v: '', t: '—' }, 'Pregão', 'PV'] },
  { nome: 'requisicao', rotulo: 'Requisição ativa', par: true },
  { nome: 'qtd_locacao', rotulo: 'Quantidade de locação (vazio = sem locação)', tipo: 'number' },
  { nome: 'planejador', rotulo: 'Planejador', par: true },
  { nome: 'valor_unit_produto', rotulo: 'Valor unitário do produto (R$)', tipo: 'number' },
  { nome: 'valor_unit_locacao', rotulo: 'Valor unitário da locação (R$)', tipo: 'number', par: true },
  { nome: 'novo_processo', rotulo: 'Novo processo / nova requisição (nº ou situação, ex.: EM COTAÇÃO)' },
  { nome: 'np_valor', rotulo: 'Novo processo: valor (R$)', tipo: 'number' },
  { nome: 'np_qtd', rotulo: 'Novo processo: quantidade', tipo: 'number', par: true },
  { nome: 'np_prazo', rotulo: 'Novo processo: prazo', par: true },
  { nome: 'np_inicio', rotulo: 'Novo processo: início', tipo: 'date' },
  { nome: 'np_termino', rotulo: 'Novo processo: término', tipo: 'date', par: true },
  { nome: 'emails', rotulo: 'E-mails do fornecedor (separados por ;)', tipo: 'textarea' },
  { nome: 'importancia', rotulo: 'Importância operacional', tipo: 'textarea' },
  { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea' },
  { nome: 'entrega_unica', rotulo: 'Entrega única', tipo: 'check' },
];
function formContrato(c) {
  formulario({
    titulo: c ? `Editar contrato — ${c.produto}` : 'Novo contrato', campos: camposContrato, largo: true,
    valores: c || {},
    enviar: async (corpo) => {
      const salvo = c ? await api('PUT', `/api/contratos/${c.id}`, { ...corpo, versao: c.versao }) : await api('POST', '/api/contratos', corpo);
      location.hash = `#/contrato/${salvo.id}`; rotear();
    },
  });
}

function formMovimento(c, m, previo = {}) {
  const editando = Boolean(m?.id);
  formulario({
    titulo: editando ? `Editar lançamento — ${c.produto}` : `Novo lançamento — ${c.produto}`,
    campos: [
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS, padrao: 'ENTRADA' },
      { nome: 'nf', rotulo: 'NF', par: true },
      { nome: 'quantidade', rotulo: `Quantidade (${c.unidade})`, tipo: 'number', obrigatorio: true },
      { nome: 'data', rotulo: 'Data', tipo: 'date', obrigatorio: true, padrao: hojeISO(), par: true },
      { nome: 'observacao', rotulo: 'Observações' },
    ],
    valores: m || previo,
    rotulo: editando ? 'Salvar' : 'Lançar',
    enviar: async (corpo, confirmar) => {
      await api(editando ? 'PUT' : 'POST', editando ? `/api/movimentos/${m.id}` : `/api/contratos/${c.id}/movimentos`,
        { ...corpo, versao: m?.versao, confirmar, solicitacao_id: previo.solicitacao_id });
      rotear();
    },
  });
}

// ---------- componentes ----------
const barra = (porc, nivel = '') => html`<div class="trilho"><div class="barra ${nivel}" style="width:${Math.max(0, Math.min(100, porc)).toFixed(1)}%"></div></div>`;
const seloSit = (c) => html`<span class="selo ${c.situacao === 'encerrado' ? 'neutro' : c.situacao}">${SITUACAO[c.situacao]}</span>`;
const selProc = (c) => c.statusProcesso === 'SOLICITAR PEDIDO' ? html`<span class="proc critico">SOLICITAR PEDIDO</span>`
  : c.statusProcesso === 'EMITIR NOVA REQ' ? html`<span class="proc atencao">EMITIR NOVA REQ</span>`
  : c.emTramite ? html`<span class="proc ok">Em andamento</span>` : html`<span class="proc neutro">—</span>`;
const nivelTempo = (c) => (c.vencido ? 'critico' : c.statusProcesso === 'SOLICITAR PEDIDO' && c.diasRestantes <= 105 ? 'critico' : c.diasRestantes <= 210 ? 'atencao' : '');
const nivelSaldo = (c) => (c.pctSaldo <= 20 ? 'critico' : c.pctSaldo <= 30 ? 'atencao' : '');

function tempoMedida(c) {
  if (!c.iniciado) return { t: `inicia em ${dias(c.diasParaInicio)}`, porc: 100, nivel: 'neutro' };
  if (c.vencido) return { t: c.diasRestantes === 0 ? 'termina hoje' : `venceu há ${dias(-c.diasRestantes)}`, porc: 0, nivel: 'critico' };
  return { t: dias(c.diasRestantes), porc: 100 - c.pctTempo, nivel: nivelTempo(c) };
}
function medidasGrandes(c) {
  const t = tempoMedida(c);
  return html`
    <div class="medida"><div class="topo-m"><span class="peq">Tempo de contrato</span><span class="peq">${dataBR(c.data_inicio)} → ${dataBR(c.data_fim)}</span></div>
      <div class="grande">${c.vencido ? t.t : `${t.t} restantes`}</div>${barra(t.porc, t.nivel)}
      <div class="peq" style="margin-top:3px">${pct(c.pctTempo)} do prazo decorrido</div></div>
    <div class="medida"><div class="topo-m"><span class="peq">Saldo contratual</span><span class="peq">de ${num(c.qtdContratada)} ${c.unidade}</span></div>
      <div class="grande">${num(c.saldo)} ${c.unidade}</div>${barra(c.pctSaldo, nivelSaldo(c))}
      <div class="peq" style="margin-top:3px">${pct(c.pctSaldo)} disponível · ${num(c.consumido)} ${c.unidade} consumidos${c.solicitadoEmAberto ? ` · ${num(c.solicitadoEmAberto)} em solicitações abertas` : ''}</div></div>`;
}

// ---------- páginas ----------
let filtroDash = 'todos', buscaDash = '';
const FILTROS = {
  todos: () => true,
  pedido: (c) => c.statusProcesso === 'SOLICITAR PEDIDO',
  req: (c) => c.statusProcesso === 'EMITIR NOVA REQ',
  v210: (c) => c.iniciado && !c.vencido && c.diasRestantes <= 210,
  saldo: (c) => !c.semContrato && c.pctSaldo <= 30,
  sem: (c) => c.semContrato,
};

async function paginaDashboard() {
  const d = await api('GET', '/api/dashboard');
  const r = d.resumo;
  const tile = (id, valor, rotulo, nivel = '') => html`<button class="tile ${nivel} ${filtroDash === id ? 'ativo' : ''}" data-f="${id}"><div class="valor">${valor}</div><div class="rotulo">${rotulo}</div></button>`;
  const linhas = () => d.contratos.filter(FILTROS[filtroDash]).filter((c) => `${c.produto} ${c.codigo} ${c.fornecedor} ${c.numero}`.toLowerCase().includes(buscaDash.toLowerCase()));
  const tabela = () => { const ls = linhas(); return ls.length ? html`<div class="tabela-rolagem"><table><thead><tr>
      <th>Produto</th><th>Fornecedor</th><th>Tempo de contrato</th><th>Saldo contratual</th><th class="num-col">Aplicação</th><th class="num-col">Locação</th><th>Processo</th></tr></thead><tbody>
      ${ls.map((c) => { const t = tempoMedida(c); return html`<tr class="clicavel" data-id="${c.id}">
        <td class="prod"><strong>${c.produto}</strong><span class="sub">${c.codigo} · contrato ${c.numero}</span></td>
        <td>${c.fornecedor}</td>
        <td class="mini-medida"><div class="t">${t.t}</div>${barra(t.porc, t.nivel)}<div class="sub" style="font-size:11px">até ${dataBR(c.data_fim)}</div></td>
        <td class="mini-medida"><div class="t">${num(c.saldo)} ${c.unidade} · ${pct(c.pctSaldo)}</div>${barra(c.pctSaldo, nivelSaldo(c))}<div class="sub" style="font-size:11px">de ${num(c.qtdContratada)}</div></td>
        <td class="num-col">${c.saldoAplicacao ? num(c.saldoAplicacao) : '—'}</td><td class="num-col">${c.saldoLocacao === null ? '—' : num(c.saldoLocacao)}</td>
        <td>${selProc(c)}${c.novoProcesso && !c.emTramite ? html`<div class="sub" style="font-size:11px">${c.novoProcesso}</div>` : ''}</td></tr>`; })}
      </tbody></table></div>` : html`<div class="vazio">Nenhum contrato neste filtro.</div>`; };

  view.innerHTML = html`
    <div class="cabecalho"><div><h1>Dashboard</h1><div class="sub">Posição de ${dataBR(d.hoje)} — tempo de contrato e saldo se atualizam sozinhos com os dias e com cada lançamento.</div></div>
      <div class="acoes"><button class="btn sec" id="nsol">Nova solicitação de fornecimento</button><button class="btn" id="novo">+ Novo contrato</button></div></div>
    ${r.contratos ? html`
    <div class="tiles">
      ${tile('todos', r.contratos, 'Contratos', 'ok')}${tile('pedido', r.solicitarPedido, 'Solicitar pedido', 'critico')}${tile('req', r.emitirReq, 'Emitir nova requisição', 'atencao')}
      ${tile('v210', r.vencendo210, 'Vencem em até 210 dias', 'atencao')}${tile('saldo', r.saldoBaixo, 'Saldo ≤ 30%', 'atencao')}${tile('sem', r.semContrato, 'Sem contrato (vencido/zerado)', 'critico')}
    </div>
    <div class="grade"><div class="painel">
      <div class="filtros"><input type="search" id="busca" placeholder="Buscar produto, código, fornecedor ou contrato" value="${buscaDash}"><span class="sub" id="cont"></span></div>
      <div id="tab">${tabela()}</div></div>
      <div><aside class="painel"><div class="secao-topo"><h2>Solicitações em aberto (${r.solicitacoesAbertas})</h2><a href="#/solicitacoes">ver todas</a></div>
        ${d.solicitacoes.length ? html`<ul class="lista-rec">${d.solicitacoes.slice(0, 6).map((s) => html`<li><div><a href="#/contrato/${s.contrato_id}">${s.produto}</a><div class="sub">${dataBR(s.data)} · ${s.fornecedor}</div></div><strong class="num-col">${num(s.quantidade)} ${s.modalidade === 'RECOLHIMENTO' ? 'cil.' : s.unidade}</strong></li>`)}</ul>` : html`<div class="sub">Nenhuma solicitação aguardando entrega.</div>`}</aside>
      <aside class="painel" style="margin-top:16px"><h2>Últimos lançamentos</h2>
        <ul class="lista-rec">${d.recentes.map((m) => html`<li><div><a href="#/contrato/${m.contrato_id}">${m.produto}</a><div class="sub">${m.tipo}${m.nf ? ` · NF ${m.nf}` : ''} · ${dataBR(m.data)}</div></div><strong class="num-col">${num(m.quantidade)} ${m.unidade}</strong></li>`)}</ul></aside></div>
    </div>` : html`<div class="painel vazio">Nenhum contrato cadastrado ainda.<br><br><button class="btn" id="imp">Importar a planilha atual</button> &nbsp; <button class="btn sec" id="novo2">Cadastrar manualmente</button></div>`}`.toString();

  const ligar = () => {
    view.querySelectorAll('tr[data-id]').forEach((tr) => { tr.onclick = () => { location.hash = `#/contrato/${tr.dataset.id}`; }; });
    const el = $('#cont'); if (el) el.textContent = `${linhas().length} de ${d.contratos.length}`;
  };
  ligar();
  view.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { filtroDash = filtroDash === b.dataset.f ? 'todos' : b.dataset.f; rotear(); }; });
  $('#busca')?.addEventListener('input', (e) => { buscaDash = e.target.value; $('#tab').innerHTML = tabela().toString(); ligar(); });
  $('#novo').onclick = () => formContrato();
  $('#nsol').onclick = () => formSolicitacao();
  $('#novo2')?.addEventListener('click', () => formContrato());
  $('#imp')?.addEventListener('click', importarPlanilha);
}

let filtroTexto = '', mostrarArquivados = false;
async function paginaContratos() {
  const lista = await api('GET', `/api/contratos?arquivados=${mostrarArquivados ? 1 : 0}`);
  const linhas = (txt) => lista.filter((c) => `${c.produto} ${c.codigo} ${c.numero} ${c.fornecedor}`.toLowerCase().includes(txt.toLowerCase()));
  const tabela = (txt) => linhas(txt).length ? html`<div class="tabela-rolagem"><table><thead><tr><th>Produto</th><th>Contrato</th><th>Fornecedor</th><th>Término</th><th class="num-col">Dias</th><th class="num-col">Contratado</th><th class="num-col">Saldo</th><th>Situação</th></tr></thead><tbody>
    ${linhas(txt).map((c) => html`<tr class="clicavel" data-id="${c.id}"><td><strong>${c.produto}</strong></td><td>${c.numero}</td><td>${c.fornecedor}</td><td>${dataBR(c.data_fim)}</td>
      <td class="num-col">${c.diasRestantes}</td><td class="num-col">${num(c.qtdContratada)} ${c.unidade}</td><td class="num-col">${num(c.saldo)} ${c.unidade}</td><td>${c.arquivado ? html`<span class="selo neutro">Arquivado</span>` : seloSit(c)}</td></tr>`)}
    </tbody></table></div>` : html`<div class="vazio">Nenhum contrato encontrado.</div>`;
  view.innerHTML = html`
    <div class="cabecalho"><div><h1>Contratos</h1><div class="sub">${lista.length} contrato(s)</div></div>
      <div class="acoes"><button class="btn sec" id="imp">Importar planilha…</button><a class="btn sec" href="/api/exportar/movimentos.csv?codigo=${encodeURIComponent(codigo)}" download>Exportar lançamentos (CSV)</a><button class="btn" id="novo">+ Novo contrato</button></div></div>
    <div class="filtros"><input type="search" id="busca" placeholder="Buscar por produto, código, contrato ou fornecedor" value="${filtroTexto}">
      <label><input type="checkbox" id="arq" ${mostrarArquivados ? 'checked' : ''}> mostrar arquivados</label></div>
    <div class="painel" id="tab">${tabela(filtroTexto)}</div>`.toString();
  const ligar = () => view.querySelectorAll('tr[data-id]').forEach((tr) => { tr.onclick = () => { location.hash = `#/contrato/${tr.dataset.id}`; }; });
  ligar();
  $('#busca').oninput = (e) => { filtroTexto = e.target.value; $('#tab').innerHTML = tabela(filtroTexto).toString(); ligar(); };
  $('#arq').onchange = (e) => { mostrarArquivados = e.target.checked; rotear(); };
  $('#novo').onclick = () => formContrato();
  $('#imp').onclick = importarPlanilha;
}

let tipoFiltro = '';
async function paginaContrato(id) {
  let c;
  try { c = await api('GET', `/api/contratos/${id}`); }
  catch (e) { view.innerHTML = html`<div class="painel vazio">${e.message}<br><br><a href="#/">Voltar ao dashboard</a></div>`.toString(); return; }
  const m = (rot, val) => html`<div><dt>${rot}</dt><dd>${val}</dd></div>`;
  const movs = c.movimentos.filter((x) => !tipoFiltro || x.tipo === tipoFiltro);
  const efeito = { ENTRADA: '−', 'SOLICITAÇÃO': '−', 'DEVOLUÇÃO': '+' };
  view.innerHTML = html`
    <div class="cabecalho"><div><div class="sub"><a href="#/">← Dashboard</a></div><h1>${c.produto} ${seloSit(c)} ${selProc(c)}</h1>
      <div class="sub">Contrato ${c.numero} · ${c.fornecedor} · código ${c.codigo || '—'}${c.aquisicao ? ` · ${c.aquisicao}` : ''}${c.entrega_unica ? ' · entrega única' : ''}</div></div>
      <div class="acoes"><button class="btn" id="lanc">+ Lançamento</button><button class="btn sec" id="sol">Solicitar fornecimento</button><button class="btn sec" id="ed">Editar</button>
        <button class="btn sec" id="arq">${c.arquivado ? 'Reativar' : 'Arquivar'}</button></div></div>
    <div class="duas">
      <div class="painel">${medidasGrandes(c)}<div class="alertas">${c.alertas.map((a) => html`<div class="alerta ${a.nivel}">${a.texto}</div>`)}</div></div>
      <div class="painel"><h2>Saldos e ritmo</h2><dl class="metricas" style="margin:0">
        ${m('Saldo de aplicação (cilindros em campo)', num(c.saldoAplicacao))}
        ${m('Saldo de locação', c.saldoLocacao === null ? '—' : `${num(c.saldoLocacao)} de ${num(c.qtd_locacao)}`)}
        ${m('Consumo médio/mês', c.consumoMedioMensal === null ? '—' : `${num(c.consumoMedioMensal)} ${c.unidade}`)}
        ${m('Necessário/mês p/ usar o saldo', c.necessarioMensal === null ? '—' : `${num(c.necessarioMensal)} ${c.unidade}`)}
        ${m('Saldo acaba (ritmo atual)', c.dataEsgotamento ? dataBR(c.dataEsgotamento) : '—')}
        ${m('Sobra projetada no fim', c.sobraNoFim === null ? '—' : `${num(c.sobraNoFim)} ${c.unidade}`)}
        ${m('Última entrada', dataBR(c.ultimaEntrada))}
        ${m('Saldo após solicitações abertas', `${num(c.saldoAposAbertas)} ${c.unidade}`)}</dl></div>
    </div>
    <div class="painel secao"><div class="secao-topo"><h2>Lançamentos (${movs.length}${tipoFiltro ? ` de ${c.movimentos.length}` : ''})</h2>
      <select id="ftipo" style="width:auto;margin:0"><option value="">Todos os tipos</option>${TIPOS.map((t) => html`<option ${t === tipoFiltro ? 'selected' : ''}>${t}</option>`)}</select></div>
      ${movs.length ? html`<div class="tabela-rolagem"><table><thead><tr><th>Data</th><th>Tipo</th><th>NF</th><th class="num-col">Quantidade</th><th>Observações</th><th></th></tr></thead><tbody>
        ${movs.map((x) => html`<tr><td>${dataBR(x.data)}</td><td>${x.tipo}</td><td>${x.nf || '—'}</td><td class="num-col">${efeito[x.tipo] || ''} ${num(x.quantidade)}</td><td>${x.observacao}</td>
          <td class="num-col"><button class="btn sec mini" data-ed="${x.id}">Editar</button> <button class="btn sec mini" data-del="${x.id}">Excluir</button></td></tr>`)}
        </tbody></table></div>` : html`<div class="vazio">Nenhum lançamento.</div>`}</div>
    <div class="duas secao">
      <div class="painel"><h2>Solicitações de fornecimento</h2>
        ${c.solicitacoes.length ? html`<ul class="lista-rec">${c.solicitacoes.slice(0, 10).map((s) => html`<li><div><a href="#/solicitacao/${s.lote}">${dataBR(s.data)} · ${s.modalidade}</a><div class="sub">${s.status}${s.observacao ? ` · ${s.observacao}` : ''}</div></div>
          <div class="num-col"><strong>${num(s.quantidade)}</strong>${s.status === 'aberta' ? html`<div><button class="btn mini" data-atender="${s.id}">Lançar entrada</button></div>` : ''}</div></li>`)}</ul>` : html`<div class="sub">Nenhuma solicitação emitida.</div>`}</div>
      <div class="painel"><h2>Dados do contrato</h2><dl class="dl2">
        ${m('Planejador', c.planejador || '—')}${m('Requisição ativa', c.requisicao || '—')}
        ${m('Valor unitário (produto)', brl(c.valor_unit_produto))}${m('Valor unitário (locação)', brl(c.valor_unit_locacao))}
        ${c.novo_processo ? m('Novo processo', c.novo_processo) : ''}${c.np_qtd ? m('Novo processo: qtd / valor / prazo', `${num(c.np_qtd)} · ${brl(c.np_valor)} · ${c.np_prazo || '—'}`) : ''}
        ${c.np_inicio ? m('Novo processo: vigência', `${dataBR(c.np_inicio)} → ${dataBR(c.np_termino)}`) : ''}
        ${m('E-mails do fornecedor', c.emails || '—')}</dl>
        ${c.importancia ? html`<h2 style="margin-top:14px">Importância operacional</h2><div>${c.importancia}</div>` : ''}${c.observacoes ? html`<h2 style="margin-top:14px">Observações</h2><div>${c.observacoes}</div>` : ''}</div>
    </div>
    <div class="painel secao"><h2>Histórico de alterações</h2>
      ${c.historico.length ? html`<ul class="lista-rec">${c.historico.slice(0, 12).map((h) => html`<li><div>${h.acao}<div class="sub">${h.detalhe}</div></div><div class="sub" style="text-align:right">${h.usuario}<br>${new Date(h.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</div></li>`)}</ul>` : ''}</div>
    <div class="secao"><button class="btn sec mini" id="excluir">Excluir contrato</button></div>`.toString();

  $('#lanc').onclick = () => formMovimento(c);
  $('#sol').onclick = () => formSolicitacao(c);
  $('#ed').onclick = () => formContrato(c);
  $('#ftipo').onchange = (e) => { tipoFiltro = e.target.value; rotear(); };
  $('#arq').onclick = async () => { await api('PUT', `/api/contratos/${c.id}`, { ...c, arquivado: !c.arquivado, versao: c.versao }).catch((e) => toast(e.message)); rotear(); };
  view.querySelectorAll('[data-ed]').forEach((b) => { b.onclick = () => formMovimento(c, c.movimentos.find((x) => x.id == b.dataset.ed)); });
  view.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => {
    const x = c.movimentos.find((n) => n.id == b.dataset.del);
    if (await confirmar(`Excluir o lançamento ${x.tipo}${x.nf ? ` NF ${x.nf}` : ''} de ${num(x.quantidade)} ${c.unidade}?`, 'Excluir', true)) { await api('DELETE', `/api/movimentos/${x.id}`).catch((e) => toast(e.message)); rotear(); }
  }; });
  view.querySelectorAll('[data-atender]').forEach((b) => { b.onclick = () => {
    const s = c.solicitacoes.find((x) => x.id == b.dataset.atender);
    formMovimento(c, null, { tipo: s.modalidade === 'RECOLHIMENTO' ? 'RECOLHIMENTO' : 'ENTRADA', quantidade: s.quantidade, solicitacao_id: s.id });
  }; });
  $('#excluir').onclick = async () => {
    if (await confirmar(`Excluir o contrato ${c.numero} (${c.produto})? Só é possível se não houver lançamentos.`, 'Excluir', true)) {
      try { await api('DELETE', `/api/contratos/${c.id}`); location.hash = '#/'; } catch (e) { toast(e.message); }
    }
  };
}

// ---- solicitações de fornecimento ----
async function formSolicitacao(inicial) {
  const todos = await api('GET', '/api/contratos');
  const ativos = todos.filter((c) => !c.vencido || c.id === inicial?.id);
  let fornecedor = inicial?.fornecedor || '';
  abrirModal(html`<form><h2>Nova solicitação de fornecimento</h2><div id="erro"></div>
    <label>Fornecedor<select id="forn"><option value="">Selecione…</option>${[...new Set(ativos.map((c) => c.fornecedor))].sort().map((f) => html`<option ${f === fornecedor ? 'selected' : ''}>${f}</option>`)}</select></label>
    <div id="itens"></div>
    <div class="rodape-modal" style="justify-content:space-between"><button type="button" class="btn sec" id="add">+ Item</button>
      <span><button type="button" class="btn sec" data-c>Cancelar</button> <button class="btn" id="ok">Emitir solicitação</button></span></div></form>`, (m) => {
    let confirmado = false;
    const itens = $('#itens', m);
    const opcoes = () => ativos.filter((c) => c.fornecedor === ($('#forn', m).value)).map((c) => ({ v: String(c.id), t: `${c.produto} (saldo ${num(c.saldo)} ${c.unidade})` }));
    const linha = (pre = {}) => {
      const d = document.createElement('div'); d.className = 'linha-item';
      d.innerHTML = `<label>Produto<select name="contrato_id">${opcoes().map((o) => `<option value="${esc(o.v)}" ${o.v == pre.contrato_id ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select></label>
        <label>Modalidade<select name="modalidade">${MODALIDADES.map((x) => `<option ${x === (pre.modalidade || 'ENTREGA PARCELADA') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Quantidade<input name="quantidade" inputmode="decimal" value="${esc(pre.quantidade ?? '')}" required></label>
        <label>Observações<input name="observacao" value="${esc(pre.observacao ?? '')}"></label>
        <button type="button" class="btn sec mini" data-rm title="Remover item">✕</button>`;
      d.querySelector('[data-rm]').onclick = () => { d.remove(); };
      itens.append(d);
    };
    const refazer = () => { itens.innerHTML = ''; if ($('#forn', m).value) linha(inicial && inicial.fornecedor === $('#forn', m).value ? { contrato_id: inicial.id } : {}); };
    $('#forn', m).onchange = () => { confirmado = false; refazer(); };
    $('#add', m).onclick = () => { if (!$('#forn', m).value) return; if (itens.children.length >= 12) return toast('Máximo de 12 itens'); linha(); };
    $('[data-c]', m).onclick = fecharModal;
    refazer();
    m.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const lista = [...itens.children].map((d) => ({ contrato_id: Number(d.querySelector('[name=contrato_id]').value), modalidade: d.querySelector('[name=modalidade]').value,
        quantidade: d.querySelector('[name=quantidade]').value, observacao: d.querySelector('[name=observacao]').value }));
      if (!lista.length) { $('#erro', m).innerHTML = '<div class="erro">Escolha o fornecedor e inclua ao menos um item.</div>'; return; }
      const btn = $('#ok', m); btn.disabled = true;
      try { const r = await api('POST', '/api/solicitacoes', { itens: lista, confirmar: confirmado }); fecharModal(); location.hash = `#/solicitacao/${r.lote}`; }
      catch (err) {
        if (err.confirmacao) { avisoConfirmacao(m, err.confirmacao); confirmado = true; btn.textContent = 'Confirmar e emitir'; }
        else $('#erro', m).innerHTML = `<div class="erro">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
    };
  }, { largo: true });
}

async function paginaSolicitacoes() {
  const lista = await api('GET', `/api/solicitacoes?status=${paginaSolicitacoes.todas ? 'todas' : 'aberta'}`);
  const lotes = new Map();
  for (const s of lista) { if (!lotes.has(s.lote)) lotes.set(s.lote, []); lotes.get(s.lote).push(s); }
  view.innerHTML = html`
    <div class="cabecalho"><div><h1>Solicitações de fornecimento</h1><div class="sub">${paginaSolicitacoes.todas ? 'Histórico' : 'Aguardando entrega'} · ${lotes.size} emissão(ões)</div></div>
      <div class="acoes"><button class="btn sec" id="alt">${paginaSolicitacoes.todas ? 'Ver só abertas' : 'Ver histórico'}</button><button class="btn" id="nova">+ Nova solicitação</button></div></div>
    ${lotes.size ? [...lotes].map(([lote, itens]) => html`<div class="painel lote"><div class="lote-topo"><strong>${itens[0].fornecedor}</strong><span class="sub">${dataBR(itens[0].data)} · ${itens[0].criado_por} · <a href="#/solicitacao/${lote}">ver / imprimir</a></span></div>
      <table><tbody>${itens.map((s) => html`<tr><td><a href="#/contrato/${s.contrato_id}">${s.produto}</a><div class="sub">${s.modalidade}${s.observacao ? ` · ${s.observacao}` : ''}</div></td>
        <td class="num-col">${num(s.quantidade)} ${s.modalidade === 'RECOLHIMENTO' ? 'cil.' : s.unidade}</td><td><span class="selo ${s.status === 'aberta' ? 'atencao' : s.status === 'atendida' ? 'ok' : 'neutro'}">${s.status}</span></td>
        <td class="num-col">${s.status === 'aberta' ? html`<button class="btn mini" data-at="${s.id}" data-c="${s.contrato_id}">Lançar entrada</button> <button class="btn sec mini" data-st="${s.id}" data-novo="cancelada">Cancelar</button>` : html`<button class="btn sec mini" data-st="${s.id}" data-novo="aberta">Reabrir</button>`}</td></tr>`)}</tbody></table></div>`)
      : html`<div class="painel vazio">Nenhuma solicitação ${paginaSolicitacoes.todas ? '' : 'em aberto'}.</div>`}`.toString();
  $('#nova').onclick = () => formSolicitacao();
  $('#alt').onclick = () => { paginaSolicitacoes.todas = !paginaSolicitacoes.todas; rotear(); };
  view.querySelectorAll('[data-st]').forEach((b) => { b.onclick = async () => { await api('PUT', `/api/solicitacoes/${b.dataset.st}`, { status: b.dataset.novo }).catch((e) => toast(e.message)); rotear(); }; });
  view.querySelectorAll('[data-at]').forEach((b) => { b.onclick = async () => {
    const c = await api('GET', `/api/contratos/${b.dataset.c}`);
    const s = lista.find((x) => x.id == b.dataset.at);
    formMovimento(c, null, { tipo: s.modalidade === 'RECOLHIMENTO' ? 'RECOLHIMENTO' : 'ENTRADA', quantidade: s.quantidade, solicitacao_id: s.id });
  }; });
}

async function paginaSolicitacao(lote) {
  let s;
  try { s = await api('GET', `/api/solicitacoes/lote/${lote}`); } catch (e) { view.innerHTML = html`<div class="painel vazio">${e.message}</div>`.toString(); return; }
  const encerrado = s.itens.some((i) => i.data_fim < hojeISO());
  view.innerHTML = html`
    <div class="cabecalho sem-impressao"><div><div class="sub"><a href="#/solicitacoes">← Solicitações</a></div><h1>Solicitação de fornecimento</h1></div>
      <div class="acoes"><button class="btn" id="print">Imprimir / salvar como PDF</button>${s.emails ? html`<a class="btn sec" href="mailto:${s.emails.split(';')[0].replace(/.*<|>.*/g, '').trim()}?subject=${encodeURIComponent('Solicitação de fornecimento')}">Abrir e-mail</a>` : ''}</div></div>
    <div class="carta">
      <p>Prezado Fornecedor <strong>${s.fornecedor}</strong>, venho na presente data ${dataBR(s.data)} requisitar os seguintes produtos abaixo, totalizando ${s.itens.length} item(s):</p>
      ${encerrado ? html`<p><strong>Contrato encerrado, favor desconsiderar essa solicitação.</strong></p>` : ''}
      <table><thead><tr><th>Modalidade</th><th>Produto</th><th class="num-col">Quantidade solicitada</th><th>UF</th><th>Código de material</th><th>Contrato</th><th>Observações</th></tr></thead><tbody>
        ${s.itens.map((i) => html`<tr><td>${i.modalidade}</td><td>${i.produto}</td><td class="num-col">${num(i.quantidade)}</td><td>${i.modalidade === 'RECOLHIMENTO' ? 'Cilindro(s)' : i.unidade}</td><td>${i.codigo}</td><td>${i.contrato_numero}</td><td>${i.observacao}</td></tr>`)}
      </tbody></table>
      <p style="margin-top:14px">Nota: os faturamentos serão processados conforme quantidade solicitada ou a menor.</p>
      <p style="margin-top:24px;font-size:12px;color:#555">Solicitação nº ${s.lote} · emitida por ${s.criado_por}</p></div>`.toString();
  $('#print').onclick = () => window.print();
}

// ---- importação da planilha ----
function importarPlanilha() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsm,.xlsx';
  inp.onchange = async () => {
    const arq = inp.files[0]; if (!arq) return;
    const enviar = async (substituir) => {
      abrirModal(html`<h2>Importando…</h2><p class="sub">Lendo ${arq.name} (pode levar alguns segundos).</p>`);
      $('#modal').dataset.fixo = '1';
      try {
        const r = await api('POST', `/api/importar${substituir ? '?substituir=1' : ''}`, new Uint8Array(await arq.arrayBuffer()), { bruto: true });
        delete $('#modal').dataset.fixo;
        abrirModal(html`<h2>Importação concluída</h2>
          <p>${r.contratos} contratos, ${r.movimentos} lançamentos e ${r.solicitacoes} solicitações em aberto.</p>
          ${r.divergencias.length ? html`<div class="aviso"><strong>Saldos diferentes dos da planilha (${r.divergencias.length}):</strong><ul>${r.divergencias.map((d) => html`<li>${d.produto}: ${d.diferencas.join('; ')}</li>`)}</ul></div>`
            : html`<div class="alerta info" style="padding:8px">Conferência: o saldo, a aplicação e a locação de todos os contratos batem com os valores da planilha.</div>`}
          ${r.avisos.length ? html`<details style="margin-top:10px"><summary>${r.avisos.length} aviso(s) da leitura</summary><ul>${r.avisos.map((a) => html`<li class="sub">${a}</li>`)}</ul></details>` : ''}
          <div class="rodape-modal"><button class="btn" data-ok>Fechar</button></div>`, (m) => { m.querySelector('[data-ok]').onclick = () => { fecharModal(); rotear(); }; });
      } catch (err) {
        delete $('#modal').dataset.fixo; fecharModal();
        if (err.jaTemDados) { if (await confirmar(`${err.message} Substituir tudo pelo conteúdo da planilha?`, 'Apagar e importar', true)) enviar(true); }
        else toast(err.message);
      }
    };
    enviar(false);
  };
  inp.click();
}

// ---------- roteamento ----------
async function rotear() {
  const [, rota, id] = (location.hash || '#/').slice(1).split('/');
  const ativo = { contratos: 'contratos', contrato: 'contratos', solicitacoes: 'solicitacoes', solicitacao: 'solicitacoes' }[rota] || 'dashboard';
  document.querySelectorAll('.topo nav a').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === ativo));
  const scroll = window.scrollY;
  try {
    if (rota === 'contratos') await paginaContratos();
    else if (rota === 'contrato') await paginaContrato(id);
    else if (rota === 'solicitacoes') await paginaSolicitacoes();
    else if (rota === 'solicitacao') await paginaSolicitacao(id);
    else await paginaDashboard();
    window.scrollTo(0, scroll);
  } catch (e) { view.innerHTML = html`<div class="painel vazio">Não foi possível carregar: ${e.message}</div>`.toString(); }
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); rotear(); });

// ---------- tempo real ----------
let atualizando;
const agendar = () => { clearTimeout(atualizando); atualizando = setTimeout(() => { if ($('#modal-fundo').hidden) rotear(); else agendar(); }, 400); };
function conectar() {
  const es = new EventSource(`/api/eventos?codigo=${encodeURIComponent(codigo)}`);
  es.onopen = () => $('#conexao').classList.add('on');
  es.onerror = () => $('#conexao').classList.remove('on');
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.usuario && ev.usuario !== usuario) {
      const o = { movimento: 'fez um lançamento', solicitacao: 'mexeu em uma solicitação', contrato: 'alterou um contrato', importacao: 'importou a planilha' }[ev.tipo] || 'fez uma alteração';
      toast(`${ev.usuario} ${o}`);
    }
    agendar();
  };
}
let diaAtual = hojeISO();
setInterval(() => { const h = hojeISO(); if (h !== diaAtual) { diaAtual = h; agendar(); } }, 60_000); // virou o dia: recalcula os prazos

$('#usuario').onclick = pedirUsuario;
(async () => {
  const s = await fetch('/api/saude').then((r) => r.json()).catch(() => ({}));
  if (s.exigeCodigo && !codigo) await pedirCodigo();
  if (!usuario) await pedirUsuario(); else $('#usuario').textContent = `👤 ${usuario}`;
  conectar();
  rotear();
})();
