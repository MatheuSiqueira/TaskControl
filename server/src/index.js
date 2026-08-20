import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import multer from 'multer';
import 'dotenv/config';
import { initStore } from './lib/store.js';
import { tasksRouter } from './routes/tasks.js';
import { deliverableRouter } from './routes/deliverable.js';
import { hasCredentials } from './ai/reviewer.js';
import { MAX_UPLOAD_BYTES } from './lib/files.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    aiEnabled: hasCredentials(),
    model: process.env.REVIEW_MODEL || 'claude-opus-5',
    maxUploadBytes: MAX_UPLOAD_BYTES,
  });
});

app.use('/api/tasks/:id/deliverable', deliverableRouter);
app.use('/api/tasks', tasksRouter);

// Em producao servimos o build do React pelo mesmo servidor.
const clientDist = path.resolve(here, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// eslint-disable-next-line no-unused-vars -- o Express so reconhece o handler de erro com 4 argumentos
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `Arquivo maior que o limite de ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`
        : `Falha no envio do arquivo: ${err.message}`;
    return res.status(413).json({ error: message });
  }
  const status = err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Erro interno do servidor.' });
});

await initStore();
app.listen(PORT, () => {
  console.log(`\n  TaskControl API em http://localhost:${PORT}`);
  console.log(
    hasCredentials()
      ? `  Revisão por IA ativa (modelo ${process.env.REVIEW_MODEL || 'claude-opus-5'}).`
      : '  ANTHROPIC_API_KEY não configurada — revisão rodando em modo demonstração.',
  );
  console.log('');
});
