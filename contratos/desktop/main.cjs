// Casca desktop: abre a interface do servidor numa janela.
//  - Modo "servidor": este PC guarda o banco e atende os demais (o servidor roda dentro do app).
//  - Modo "cliente":  este PC só se conecta ao endereço do servidor.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const arquivoConfig = () => path.join(app.getPath('userData'), 'config.json');
const lerConfig = () => { try { return JSON.parse(fs.readFileSync(arquivoConfig(), 'utf8')); } catch { return null; } };
const gravarConfig = (c) => fs.writeFileSync(arquivoConfig(), JSON.stringify(c, null, 2));

let janela = null;
let servidor = null;

async function pararServidor() { if (servidor) { await servidor.parar(); servidor = null; } }

async function conectar(cfg) {
  await pararServidor();
  if (cfg.modo === 'servidor') {
    const { iniciarServidor } = await import('../server/index.js');
    const dbPath = path.join(app.getPath('userData'), 'dados', 'contratos.db');
    servidor = await iniciarServidor({ porta: cfg.porta || 3210, dbPath, codigoAcesso: cfg.codigo || '' });
    janela.loadURL(`http://127.0.0.1:${servidor.porta}/`);
    janela.setTitle(`Controle de Contratos — servidor (${servidor.enderecos.join(', ') || 'sem rede'})`);
  } else {
    janela.loadURL(cfg.endereco);
    janela.setTitle(`Controle de Contratos — ${cfg.endereco}`);
  }
}

function mostrarConfiguracao() {
  janela.loadFile(path.join(__dirname, 'config.html'));
  janela.setTitle('Controle de Contratos — configuração');
}

function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Arquivo', submenu: [
      { label: 'Trocar servidor / modo…', click: mostrarConfiguracao },
      { label: 'Fazer backup do banco…', click: fazerBackup },
      { type: 'separator' }, { role: 'quit', label: 'Sair' },
    ] },
    { label: 'Exibir', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
  ]));
}

async function fazerBackup() {
  if (!servidor) return dialog.showMessageBox(janela, { message: 'O backup é feito no computador que está como servidor.' });
  const carimbo = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(janela, { defaultPath: `contratos-backup-${carimbo}.db`, filters: [{ name: 'Banco SQLite', extensions: ['db'] }] });
  if (r.canceled) return;
  try { fs.rmSync(r.filePath, { force: true }); servidor.backup(r.filePath); dialog.showMessageBox(janela, { message: 'Backup salvo.', detail: r.filePath }); }
  catch (e) { dialog.showErrorBox('Falha no backup', e.message); }
}

ipcMain.handle('config:ler', () => ({ config: lerConfig(), enderecos: servidor?.enderecos || [] }));
ipcMain.handle('config:testar', async (_e, endereco) => {
  try {
    const r = await fetch(new URL('/api/saude', endereco), { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    return j.ok ? { ok: true } : { ok: false, erro: 'O endereço respondeu, mas não é o servidor de contratos.' };
  } catch (e) { return { ok: false, erro: 'Não foi possível conectar. Confira o endereço e se o servidor está ligado.' }; }
});
ipcMain.handle('config:salvar', async (_e, cfg) => {
  if (cfg.modo === 'cliente') {
    try { cfg.endereco = new URL(/^https?:\/\//.test(cfg.endereco) ? cfg.endereco : `http://${cfg.endereco}`).origin; }
    catch { return { ok: false, erro: 'Endereço inválido.' }; }
  } else {
    cfg.porta = Number(cfg.porta) || 3210;
  }
  try { await conectar(cfg); } catch (e) { return { ok: false, erro: e.code === 'EADDRINUSE' ? `A porta ${cfg.porta} já está em uso neste computador.` : e.message }; }
  gravarConfig(cfg);
  return { ok: true };
});

app.whenReady().then(async () => {
  janela = new BrowserWindow({
    width: 1360, height: 900, minWidth: 900, minHeight: 600,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Links externos abrem no navegador; a janela só navega no servidor configurado.
  janela.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  janela.webContents.on('did-fail-load', (_e, _c, desc, url) => {
    if (url.startsWith('http')) {
      janela.loadFile(path.join(__dirname, 'config.html'), { query: { erro: `Sem conexão com o servidor (${desc}).` } });
    }
  });
  janela.on('page-title-updated', (e) => e.preventDefault()); // mantém no título o endereço do servidor
  menu();
  const cfg = lerConfig();
  if (!cfg) return mostrarConfiguracao();
  try { await conectar(cfg); } catch (e) { mostrarConfiguracao(); dialog.showErrorBox('Não foi possível iniciar', e.message); }
});

app.on('window-all-closed', async () => { await pararServidor(); app.quit(); });
