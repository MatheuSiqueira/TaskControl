import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarApp } from './app.js';

export function iniciarServidor({ porta = 3210, dbPath, codigoAcesso = '' } = {}) {
  const { app, fechar, backup } = criarApp({ dbPath, codigoAcesso });
  return new Promise((resolve, reject) => {
    const srv = app.listen(porta, '0.0.0.0', () => resolve({
      porta, backup,
      enderecos: enderecosDaRede().map((ip) => `http://${ip}:${porta}`),
      parar: () => new Promise((ok) => { fechar(); srv.close(ok); srv.closeAllConnections?.(); }),
    }));
    srv.on('error', reject);
  });
}

export function enderecosDaRede() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

// Execução direta: `npm run server`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dbPath = process.env.CONTRATOS_DB || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dados', 'contratos.db');
  const s = await iniciarServidor({ porta: Number(process.env.PORT) || 3210, dbPath, codigoAcesso: process.env.CODIGO_ACESSO || '' });
  console.log(`Servidor no ar. Banco: ${dbPath}`);
  console.log('Endereços para os outros computadores:');
  for (const e of s.enderecos) console.log('  ' + e);
}
