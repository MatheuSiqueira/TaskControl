import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = path.resolve(here, '..', '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = { version: 1, tasks: [] };

let cache = null;
/** Fila de escrita: garante que dois writes concorrentes nao se sobrescrevam. */
let writeChain = Promise.resolve();

function seed() {
  const now = new Date().toISOString();
  const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  return {
    ...EMPTY,
    tasks: [
      {
        id: crypto.randomUUID(),
        title: 'Relatório mensal de vendas',
        description:
          'Consolidar os números de vendas do mês e enviar o relatório em Markdown para revisão.',
        assignee: 'Equipe Comercial',
        priority: 'alta',
        dueDate: inDays(5),
        status: 'em_andamento',
        requiresFile: true,
        fileCriteria:
          'O relatório deve conter: título, período analisado, tabela com receita por produto, ' +
          'comparativo com o mês anterior em porcentagem e uma conclusão com próximos passos. ' +
          'Verifique erros de português, números inconsistentes e falta de contexto.',
        minScore: 75,
        deliverable: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        title: 'Revisar contrato do fornecedor',
        description: 'Ler o contrato e apontar cláusulas de risco antes da assinatura.',
        assignee: 'Jurídico',
        priority: 'media',
        dueDate: inDays(12),
        status: 'pendente',
        requiresFile: true,
        fileCriteria:
          'Procure ambiguidades, cláusulas abusivas, prazos sem definição clara e ausência de ' +
          'multa por descumprimento. Aponte trechos exatos que precisam ser reescritos.',
        minScore: 80,
        deliverable: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        title: 'Agendar reunião de alinhamento',
        description: 'Marcar a reunião semanal com o time e enviar a pauta por e-mail.',
        assignee: 'Matheus',
        priority: 'baixa',
        dueDate: inDays(2),
        status: 'pendente',
        requiresFile: false,
        fileCriteria: '',
        minScore: 70,
        deliverable: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export async function initStore() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    cache = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    cache = seed();
    await persist();
  }
  return cache;
}

function persist() {
  const snapshot = JSON.stringify(cache, null, 2);
  writeChain = writeChain.then(async () => {
    const tmp = `${DB_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, snapshot, 'utf8');
    await fs.rename(tmp, DB_FILE); // rename e atomico no mesmo filesystem
  });
  return writeChain;
}

export function getDb() {
  if (!cache) throw new Error('Store nao inicializado. Chame initStore() primeiro.');
  return cache;
}

export async function save() {
  await persist();
}

export function listTasks() {
  return getDb().tasks;
}

export function findTask(id) {
  return getDb().tasks.find((t) => t.id === id) ?? null;
}
