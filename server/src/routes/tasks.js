import { Router } from 'express';
import { findTask, getDb, listTasks, save } from '../lib/store.js';
import { PRIORITIES, STATUSES, completionBlockers, serializeTask } from '../lib/gate.js';

export const tasksRouter = Router();

tasksRouter.get('/', (req, res) => {
  res.json({ tasks: listTasks().map(serializeTask) });
});

tasksRouter.get('/:id', (req, res) => {
  const task = findTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });
  res.json({ task: serializeTask(task) });
});

tasksRouter.post('/', async (req, res) => {
  let fields;
  try {
    fields = readFields(req.body, { requireTitle: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const now = new Date().toISOString();
  const task = {
    id: crypto.randomUUID(),
    title: fields.title,
    description: fields.description ?? '',
    assignee: fields.assignee ?? '',
    priority: fields.priority ?? 'media',
    dueDate: fields.dueDate ?? '',
    status: fields.status ?? 'pendente',
    requiresFile: fields.requiresFile ?? false,
    fileCriteria: fields.fileCriteria ?? '',
    minScore: fields.minScore ?? 70,
    deliverable: null,
    createdAt: now,
    updatedAt: now,
  };

  if (task.status === 'concluida' && completionBlockers(task).length) {
    task.status = 'pendente';
  }

  getDb().tasks.unshift(task);
  await save();
  res.status(201).json({ task: serializeTask(task) });
});

tasksRouter.patch('/:id', async (req, res) => {
  const task = findTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });

  let fields;
  try {
    fields = readFields(req.body, { requireTitle: false });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // A trava de conclusao vale para qualquer caminho que leve ao status "concluida".
  if (fields.status === 'concluida') {
    const blockers = completionBlockers(task);
    if (blockers.length) {
      return res.status(409).json({
        error: 'Esta tarefa ainda não pode ser concluída.',
        blockers,
        task: serializeTask(task),
      });
    }
  }

  Object.assign(task, fields);
  task.updatedAt = new Date().toISOString();
  await save();
  res.json({ task: serializeTask(task) });
});

tasksRouter.delete('/:id', async (req, res) => {
  const db = getDb();
  const index = db.tasks.findIndex((t) => t.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Tarefa não encontrada.' });
  db.tasks.splice(index, 1);
  await save();
  res.json({ ok: true });
});

/** Le e valida apenas os campos presentes no corpo da requisicao. */
function readFields(body = {}, { requireTitle }) {
  const out = {};

  if (body.title !== undefined || requireTitle) {
    const title = String(body.title ?? '').trim();
    if (!title) throw new Error('O título da tarefa é obrigatório.');
    if (title.length > 200) throw new Error('O título deve ter no máximo 200 caracteres.');
    out.title = title;
  }

  if (body.description !== undefined) out.description = String(body.description).slice(0, 5000);
  if (body.assignee !== undefined) out.assignee = String(body.assignee).slice(0, 120);
  if (body.dueDate !== undefined) out.dueDate = String(body.dueDate).slice(0, 10);
  if (body.fileCriteria !== undefined) out.fileCriteria = String(body.fileCriteria).slice(0, 5000);

  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) throw new Error('Prioridade inválida.');
    out.priority = body.priority;
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new Error('Status inválido.');
    out.status = body.status;
  }

  if (body.requiresFile !== undefined) out.requiresFile = Boolean(body.requiresFile);

  if (body.minScore !== undefined) {
    const score = Number(body.minScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error('A nota mínima deve ser um número entre 0 e 100.');
    }
    out.minScore = Math.round(score);
  }

  return out;
}
