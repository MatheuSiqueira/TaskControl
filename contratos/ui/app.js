// Interface sem build: ES modules direto no navegador/Electron.
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');

// ---------- utilidades ----------
class Seguro { constructor(s) { this.s = s; } toString() { return this.s; } }
const bruto = (s) => new Seguro(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Todo valor interpolado é escapado, a menos que venha de bruto()/html().
const html = (partes, ...vals) => bruto(partes.reduce((a, p, i) => a + p + (i < vals.length ? [].concat(vals[i]).map((v) => (v instanceof Seguro ? v.s : esc(v))).join('') : ''), ''));
const brl = (n) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (n) => `${Math.round(n)}%`;
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const dias = (n) => `${n} dia${Math.abs(n) === 1 ? '' : 's'}`;
const ROTULO = { critico: 'Crítico', atencao: 'Atenção', ok: 'Em dia', futuro: 'A iniciar' };

let usuario = localStorage.getItem('usuario') || '';
let codigo = sessionStorage.getItem('codigo') || '';

async function api(metodo, url, corpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-usuario': encodeURIComponent(usuario), 'x-codigo': codigo },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (r.status === 401) { await pedirCodigo(); return api(metodo, url, corpo); }
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
function abrirModal(conteudo, aoMontar) {
  $('#modal').innerHTML = conteudo.toString();
  $('#modal-fundo').hidden = false;
  aoMontar?.($('#modal'));
  $('#modal input, #modal textarea')?.focus();
}
const fecharModal = () => { $('#modal-fundo').hidden = true; $('#modal').innerHTML = ''; };
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
      m.querySelector('form').onsubmit = (e) => { e.preventDefault(); const v = new FormData(e.target).get('v').trim(); if (!v) return; delete m.dataset.fixo; fecharModal(); ok(v); };
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

// ---------- formulários ----------
function formulario({ titulo, campos, valores = {}, enviar, rotulo = 'Salvar' }) {
  const campo = (c) => c.tipo === 'textarea'
    ? html`<label>${c.rotulo}<textarea name="${c.nome}" rows="3">${valores[c.nome] ?? ''}</textarea></label>`
    : html`<label>${c.rotulo}<input name="${c.nome}" type="${c.tipo || 'text'}" ${c.tipo === 'number' ? bruto('step="0.01"') : ''} value="${valores[c.nome] ?? ''}" ${c.obrigatorio ? 'required' : ''} autocomplete="off"></label>`;
  const grupos = []; // campos com `par: true` entram lado a lado com o anterior
  for (const c of campos) (c.par && grupos.length ? grupos[grupos.length - 1].push(c) : grupos.push([c]));
  abrirModal(html`<form><h2>${titulo}</h2><div id="erro"></div>
    ${grupos.map((g) => g.length > 1 ? html`<div class="campos2">${g.map(campo)}</div>` : campo(g[0]))}
    <div class="rodape-modal"><button type="button" class="btn sec" data-c>Cancelar</button><button class="btn">${rotulo}</button></div></form>`, (m) => {
    m.querySelector('[data-c]').onclick = fecharModal;
    m.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const corpo = Object.fromEntries(new FormData(e.target));
      const btn = m.querySelector('form .btn:not(.sec)'); btn.disabled = true;
      try { await enviar(corpo); fecharModal(); }
      catch (err) { m.querySelector('#erro').innerHTML = `<div class="erro">${esc(err.message)}</div>`; btn.disabled = false; }
    };
  });
}

const camposContrato = [
  { nome: 'numero', rotulo: 'Nº do contrato', obrigatorio: true },
  { nome: 'fornecedor', rotulo: 'Fornecedor', obrigatorio: true, par: true },
  { nome: 'objeto', rotulo: 'Objeto' },
  { nome: 'data_inicio', rotulo: 'Início da vigência', tipo: 'date', obrigatorio: true },
  { nome: 'data_fim', rotulo: 'Fim da vigência', tipo: 'date', obrigatorio: true, par: true },
  { nome: 'valor_inicial', rotulo: 'Valor do contrato (R$)', tipo: 'number', obrigatorio: true },
  { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea' },
];

function formContrato(c) {
  formulario({
    titulo: c ? `Editar contrato ${c.numero}` : 'Novo contrato',
    campos: camposContrato,
    valores: c ? { ...c, data_fim: c.data_fim_original } : {},
    enviar: async (corpo) => {
      const salvo = c ? await api('PUT', `/api/contratos/${c.id}`, { ...corpo, versao: c.versao }) : await api('POST', '/api/contratos', corpo);
      location.hash = `#/contrato/${salvo.id}`;
      rotear();
    },
  });
}

function formNota(contrato, n) {
  const hoje = new Date().toLocaleDateString('sv-SE');
  const campos = [
    { nome: 'numero', rotulo: 'Nº da nota fiscal', obrigatorio: true },
    { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'number', obrigatorio: true, par: true },
    { nome: 'data_emissao', rotulo: 'Data de emissão', tipo: 'date' },
    { nome: 'data_entrada', rotulo: 'Data de entrada', tipo: 'date', obrigatorio: true, par: true },
    { nome: 'observacao', rotulo: 'Observação' },
  ];
  const enviar = async (corpo, confirmarExcesso = false) => {
    const editando = Boolean(n?.id);
    const url = editando ? `/api/notas/${n.id}` : `/api/contratos/${contrato.id}/notas`;
    try { await api(editando ? 'PUT' : 'POST', url, { ...corpo, versao: n?.versao, confirmarExcesso }); }
    catch (err) {
      if (!err.excedeSaldo) throw err;
      fecharModal();
      if (await confirmar(`${err.message} Lançar mesmo assim?`, 'Lançar mesmo assim', true)) return enviar(corpo, true);
      formNota(contrato, { ...n, ...corpo }); // reabre com o que foi digitado
      throw new Error('Nota não lançada: ela excede o saldo do contrato.');
    }
    rotear();
  };
  formulario({ titulo: n?.id ? `Editar NF ${n.numero}` : `Lançar nota fiscal em ${contrato.numero}`, campos, valores: n || { data_entrada: hoje }, enviar, rotulo: n?.id ? 'Salvar' : 'Lançar' });
}

function formAditivo(contrato) {
  formulario({
    titulo: `Aditivo — ${contrato.numero}`,
    campos: [
      { nome: 'descricao', rotulo: 'Descrição (ex.: 1º termo aditivo)' },
      { nome: 'valor_delta', rotulo: 'Acréscimo/supressão de valor (R$, negativo reduz)', tipo: 'number' },
      { nome: 'nova_data_fim', rotulo: `Nova data de fim (atual: ${dataBR(contrato.dataFim)})`, tipo: 'date' },
    ],
    enviar: async (corpo) => { await api('POST', `/api/contratos/${contrato.id}/aditivos`, corpo); rotear(); },
  });
}

// ---------- componentes ----------
const barra = (porc, nivel = '') => html`<div class="trilho"><div class="barra ${nivel}" style="width:${Math.max(0, Math.min(100, porc)).toFixed(1)}%"></div></div>`;
const seloSit = (c) => html`<span class="selo ${c.situacao}">${c.vencido ? 'Vencido' : ROTULO[c.situacao]}</span>`;

function tempoTexto(c) {
  if (!c.iniciado) return { grande: `Inicia em ${dias(c.diasParaInicio)}`, peq: `Vigência ${dataBR(c.data_inicio)} a ${dataBR(c.dataFim)}`, nivel: 'neutro', porc: 100 };
  if (c.vencido) return { grande: `Venceu há ${dias(-c.diasRestantes)}`, peq: `Fim em ${dataBR(c.dataFim)}`, nivel: 'critico', porc: 0 };
  const nivel = c.diasRestantes <= 30 ? 'critico' : c.diasRestantes <= 90 ? 'atencao' : '';
  return { grande: `${dias(c.diasRestantes)} restantes`, peq: `Fim em ${dataBR(c.dataFim)} · ${pct(100 - c.pctTempo)} do prazo`, nivel, porc: 100 - c.pctTempo };
}
function saldoNivel(c) { return c.saldo <= 0 ? 'critico' : c.pctSaldo <= 10 ? 'critico' : c.pctSaldo <= 25 ? 'atencao' : ''; }

function medidas(c) {
  const t = tempoTexto(c);
  return html`
    <div class="medida"><div class="topo-m"><span class="peq">Tempo de contrato</span><span class="peq">${t.peq}</span></div>
      <div class="grande">${t.grande}</div>${barra(t.porc, t.nivel)}</div>
    <div class="medida"><div class="topo-m"><span class="peq">Saldo contratual</span><span class="peq">de ${brl(c.total)}</span></div>
      <div class="grande">${brl(c.saldo)}</div>${barra(c.pctSaldo, saldoNivel(c))}
      <div class="peq" style="margin-top:3px">${pct(c.pctSaldo)} disponível · ${brl(c.consumido)} consumidos em ${c.qtdNotas} NF</div></div>`;
}

// ---------- páginas ----------
async function paginaDashboard() {
  const d = await api('GET', '/api/dashboard');
  const r = d.resumo;
  view.innerHTML = html`
    <div class="cabecalho"><div><h1>Dashboard</h1><div class="sub">Posição de ${dataBR(d.hoje)} — prazo e saldo se atualizam sozinhos a cada dia e a cada nota lançada.</div></div>
      <div class="acoes"><button class="btn" id="novo">+ Novo contrato</button></div></div>
    <div class="kpis">
      <div class="painel kpi"><div class="rotulo">Saldo contratual vigente</div><div class="valor">${brl(r.saldoVigente)}</div>
        <div class="nota">${r.totalVigente ? pct((r.saldoVigente / r.totalVigente) * 100) : '0%'} de ${brl(r.totalVigente)}</div></div>
      <div class="painel kpi"><div class="rotulo">Consumido (notas fiscais)</div><div class="valor">${brl(r.consumidoVigente)}</div><div class="nota">nos contratos vigentes</div></div>
      <div class="painel kpi"><div class="rotulo">Contratos vigentes</div><div class="valor">${r.vigentes}</div><div class="nota">${r.contratos} cadastrados ativos</div></div>
      <div class="painel kpi"><div class="rotulo">Precisam de atenção</div><div class="valor" style="color:${r.emCritico ? 'var(--critico)' : 'inherit'}">${r.emCritico + r.emAtencao}</div>
        <div class="nota">${r.emCritico} crítico(s) · ${r.emAtencao} atenção · ${r.vencendo90} vencem em 90 dias</div></div>
    </div>
    <div class="grade">
      <div>${d.contratos.length ? html`<div class="cards">${d.contratos.map((c) => html`
        <a class="painel card ${c.situacao}" href="#/contrato/${c.id}">
          <div class="linha1"><span class="num">${c.numero}</span>${seloSit(c)}</div>
          <div class="forn">${c.fornecedor}${c.objeto ? ` — ${c.objeto}` : ''}</div>
          ${medidas(c)}
          <div class="alertas">${c.alertas.map((a) => html`<div class="alerta ${a.nivel}">${a.texto}</div>`)}</div>
        </a>`)}</div>` : html`<div class="painel vazio">Nenhum contrato cadastrado ainda.<br><br><button class="btn" id="novo2">Cadastrar o primeiro contrato</button></div>`}</div>
      <aside class="painel"><h2>Últimas entradas de NF</h2>
        ${d.recentes.length ? html`<ul class="lista-rec">${d.recentes.map((n) => html`<li><div><a href="#/contrato/${n.contrato_id}">NF ${n.numero}</a><div class="sub">${n.contrato_numero} · ${dataBR(n.data_entrada)}</div></div><strong class="num-col">${brl(n.valor)}</strong></li>`)}</ul>` : html`<div class="vazio">Sem notas lançadas.</div>`}
      </aside>
    </div>`.toString();
  $('#novo').onclick = () => formContrato();
  $('#novo2')?.addEventListener('click', () => formContrato());
}

let filtroTexto = '', mostrarArquivados = false;
async function paginaContratos() {
  const lista = await api('GET', `/api/contratos?arquivados=${mostrarArquivados ? 1 : 0}`);
  const linhas = (txt) => lista.filter((c) => `${c.numero} ${c.fornecedor} ${c.objeto}`.toLowerCase().includes(txt.toLowerCase()));
  const tabela = (txt) => linhas(txt).length ? html`<table><thead><tr><th>Contrato</th><th>Fornecedor</th><th>Fim</th><th class="num-col">Dias</th><th class="num-col">Valor total</th><th class="num-col">Saldo</th><th>Situação</th></tr></thead><tbody>
    ${linhas(txt).map((c) => html`<tr class="clicavel" data-id="${c.id}"><td><strong>${c.numero}</strong></td><td>${c.fornecedor}</td><td>${dataBR(c.dataFim)}</td>
      <td class="num-col">${c.vencido ? `−${-c.diasRestantes}` : c.diasRestantes}</td><td class="num-col">${brl(c.total)}</td><td class="num-col">${brl(c.saldo)}</td><td>${c.arquivado ? html`<span class="selo neutro">Arquivado</span>` : seloSit(c)}</td></tr>`)}
    </tbody></table>` : html`<div class="vazio">Nenhum contrato encontrado.</div>`;
  view.innerHTML = html`
    <div class="cabecalho"><div><h1>Contratos</h1><div class="sub">${lista.length} contrato(s)</div></div>
      <div class="acoes"><a class="btn sec" href="/api/exportar/notas.csv?codigo=${encodeURIComponent(codigo)}" download>Exportar NFs (CSV)</a><button class="btn" id="novo">+ Novo contrato</button></div></div>
    <div class="filtros"><input type="search" id="busca" placeholder="Buscar por número, fornecedor ou objeto" value="${filtroTexto}">
      <label><input type="checkbox" id="arq" ${mostrarArquivados ? 'checked' : ''}> mostrar arquivados</label></div>
    <div class="painel" id="tab">${tabela(filtroTexto)}</div>`.toString();
  const ligar = () => view.querySelectorAll('tr[data-id]').forEach((tr) => { tr.onclick = () => { location.hash = `#/contrato/${tr.dataset.id}`; }; });
  ligar();
  $('#busca').oninput = (e) => { filtroTexto = e.target.value; $('#tab').innerHTML = tabela(filtroTexto).toString(); ligar(); };
  $('#arq').onchange = (e) => { mostrarArquivados = e.target.checked; rotear(); };
  $('#novo').onclick = () => formContrato();
}

async function paginaContrato(id) {
  let c;
  try { c = await api('GET', `/api/contratos/${id}`); }
  catch (e) { view.innerHTML = html`<div class="painel vazio">${e.message}<br><br><a href="#/">Voltar ao dashboard</a></div>`.toString(); return; }
  const m = (rot, val) => html`<div><dt>${rot}</dt><dd>${val}</dd></div>`;
  view.innerHTML = html`
    <div class="cabecalho"><div><div class="sub"><a href="#/">← Dashboard</a></div><h1>Contrato ${c.numero} ${seloSit(c)}</h1>
      <div class="sub">${c.fornecedor}${c.objeto ? ` — ${c.objeto}` : ''}</div></div>
      <div class="acoes"><button class="btn" id="nf">+ Lançar nota fiscal</button><button class="btn sec" id="ad">+ Aditivo</button><button class="btn sec" id="ed">Editar</button>
        <button class="btn sec" id="arq">${c.arquivado ? 'Reativar' : 'Arquivar'}</button></div></div>
    <div class="duas">
      <div class="painel">${medidas(c)}<div class="alertas">${c.alertas.map((a) => html`<div class="alerta ${a.nivel}">${a.texto}</div>`)}</div></div>
      <div class="painel"><h2>Análise de ritmo</h2><dl class="metricas" style="margin:0">
        ${m('Vigência', `${dataBR(c.data_inicio)} → ${dataBR(c.dataFim)}`)}
        ${m('Prazo decorrido', `${pct(c.pctTempo)} (${dias(c.diasDecorridos)})`)}
        ${m('Valor consumido', pct(c.pctConsumido))}
        ${m('Consumo médio/mês', c.consumoMedioMensal === null ? '—' : brl(c.consumoMedioMensal))}
        ${m('Necessário/mês p/ usar o saldo', c.necessarioMensal === null ? '—' : brl(c.necessarioMensal))}
        ${m('Saldo acaba (no ritmo atual)', c.dataEsgotamento ? dataBR(c.dataEsgotamento) : '—')}
        ${m('Sobra projetada no fim', c.sobraNoFim === null ? '—' : brl(c.sobraNoFim))}
        ${m('Última entrada de NF', dataBR(c.ultimaEntrada))}</dl></div>
    </div>
    <div class="painel secao"><div class="secao-topo"><h2>Notas fiscais (${c.notas.length})</h2></div>
      ${c.notas.length ? html`<table><thead><tr><th>NF</th><th>Entrada</th><th>Emissão</th><th>Observação</th><th class="num-col">Valor</th><th></th></tr></thead><tbody>
        ${c.notas.map((n) => html`<tr><td><strong>${n.numero}</strong></td><td>${dataBR(n.data_entrada)}</td><td>${dataBR(n.data_emissao)}</td><td>${n.observacao}</td><td class="num-col">${brl(n.valor)}</td>
          <td class="num-col"><button class="btn sec mini" data-ed="${n.id}">Editar</button> <button class="btn sec mini" data-del="${n.id}">Excluir</button></td></tr>`)}
        </tbody></table>` : html`<div class="vazio">Nenhuma nota lançada neste contrato.</div>`}</div>
    <div class="duas secao">
      <div class="painel"><div class="secao-topo"><h2>Aditivos</h2></div>
        ${c.aditivos.length ? html`<table><tbody>${c.aditivos.map((a) => html`<tr><td>${a.descricao || 'Aditivo'}<div class="sub">${a.nova_data_fim ? `novo fim ${dataBR(a.nova_data_fim)}` : ''}</div></td>
          <td class="num-col">${a.valor_delta ? brl(a.valor_delta) : ''}</td><td class="num-col"><button class="btn sec mini" data-deladit="${a.id}">Remover</button></td></tr>`)}</tbody></table>` : html`<div class="sub">Sem aditivos. Valor original: ${brl(c.valor_inicial)}.</div>`}</div>
      <div class="painel"><div class="secao-topo"><h2>Histórico de alterações</h2></div>
        ${c.historico.length ? html`<ul class="lista-rec">${c.historico.slice(0, 12).map((h) => html`<li><div>${h.acao}<div class="sub">${h.detalhe}</div></div><div class="sub" style="text-align:right">${h.usuario}<br>${new Date(h.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</div></li>`)}</ul>` : ''}</div>
    </div>
    ${c.observacoes ? html`<div class="painel secao"><h2>Observações</h2>${c.observacoes}</div>` : ''}
    <div class="secao"><button class="btn sec mini" id="excluir">Excluir contrato</button></div>`.toString();

  $('#nf').onclick = () => formNota(c);
  $('#ad').onclick = () => formAditivo(c);
  $('#ed').onclick = () => formContrato(c);
  $('#arq').onclick = async () => { await api('PUT', `/api/contratos/${c.id}`, { ...c, data_fim: c.data_fim_original, arquivado: !c.arquivado, versao: c.versao }).catch((e) => toast(e.message)); rotear(); };
  view.querySelectorAll('[data-ed]').forEach((b) => { b.onclick = () => formNota(c, c.notas.find((n) => n.id == b.dataset.ed)); });
  view.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => {
    const n = c.notas.find((x) => x.id == b.dataset.del);
    if (await confirmar(`Excluir a NF ${n.numero} (${brl(n.valor)})? O saldo será devolvido.`, 'Excluir', true)) { await api('DELETE', `/api/notas/${n.id}`).catch((e) => toast(e.message)); rotear(); }
  }; });
  view.querySelectorAll('[data-deladit]').forEach((b) => { b.onclick = async () => {
    if (await confirmar('Remover este aditivo?', 'Remover', true)) { await api('DELETE', `/api/aditivos/${b.dataset.deladit}`).catch((e) => toast(e.message)); rotear(); }
  }; });
  $('#excluir').onclick = async () => {
    if (await confirmar(`Excluir o contrato ${c.numero}? Só é possível se não houver notas lançadas.`, 'Excluir', true)) {
      try { await api('DELETE', `/api/contratos/${c.id}`); location.hash = '#/'; } catch (e) { toast(e.message); }
    }
  };
}

// ---------- roteamento ----------
async function rotear() {
  const [, rota, id] = (location.hash || '#/').slice(1).split('/');
  document.querySelectorAll('.topo nav a').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === (rota === 'contrato' ? 'contratos' : rota || 'dashboard')));
  const scroll = window.scrollY;
  try {
    if (rota === 'contratos') await paginaContratos();
    else if (rota === 'contrato') await paginaContrato(id);
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
      const o = { nota: 'lançou/alterou uma nota fiscal', aditivo: 'alterou um aditivo', contrato: 'alterou um contrato' }[ev.tipo] || 'fez uma alteração';
      toast(`${ev.usuario} ${o}`);
    }
    agendar();
  };
}
let diaAtual = new Date().toLocaleDateString('sv-SE');
setInterval(() => { // virou o dia com a tela aberta: recalcula os prazos
  const hoje = new Date().toLocaleDateString('sv-SE');
  if (hoje !== diaAtual) { diaAtual = hoje; agendar(); }
}, 60_000);

$('#usuario').onclick = pedirUsuario;
(async () => {
  const s = await fetch('/api/saude').then((r) => r.json()).catch(() => ({}));
  if (s.exigeCodigo && !codigo) await pedirCodigo();
  if (!usuario) await pedirUsuario(); else $('#usuario').textContent = `👤 ${usuario}`;
  conectar();
  rotear();
})();
