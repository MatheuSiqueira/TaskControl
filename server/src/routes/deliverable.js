import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { UPLOAD_DIR, currentVersion, findTask, save } from '../lib/store.js';
import { serializeReview, serializeTask } from '../lib/gate.js';
import { MAX_UPLOAD_BYTES, classify, safeName } from '../lib/files.js';
import { hasCredentials, reviewFile } from '../ai/reviewer.js';

export const deliverableRouter = Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

/** Carrega a tarefa da URL ou responde 404. */
function requireTask(req, res) {
  const task = findTask(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Tarefa não encontrada.' });
    return null;
  }
  return task;
}

/** Impede que um nome gravado no banco escape do diretorio de uploads. */
function resolveStored(storedName) {
  const full = path.resolve(UPLOAD_DIR, storedName);
  if (!full.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
    throw Object.assign(new Error('Caminho de arquivo inválido.'), { statusCode: 400 });
  }
  return full;
}

deliverableRouter.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const task = requireTask(req, res);
    if (!task) return;
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo foi enviado.' });

    const { buffer, originalname, mimetype, size } = req.file;
    const parsed = classify(buffer, originalname, mimetype);
    if (parsed.kind === 'unsupported') {
      return res.status(415).json({ error: parsed.reason });
    }

    if (!task.deliverable) {
      task.deliverable = {
        originalName: originalname,
        mime: mimetype,
        currentVersion: 0,
        versions: [],
        reviews: [],
      };
    }

    const version = task.deliverable.currentVersion + 1;
    const storedName = `${task.id}-v${version}-${safeName(originalname)}`;
    await fs.writeFile(resolveStored(storedName), buffer);

    task.deliverable.originalName = originalname;
    task.deliverable.mime = mimetype;
    task.deliverable.currentVersion = version;
    task.deliverable.versions.push({
      version,
      storedName,
      originalName: originalname,
      mime: mimetype,
      size,
      createdAt: new Date().toISOString(),
      source: 'upload',
    });

    // Um envio novo derruba a aprovacao anterior: a versao nova precisa ser revisada.
    if (task.status === 'concluida') task.status = 'em_revisao';
    task.updatedAt = new Date().toISOString();
    await save();

    res.status(201).json({ task: serializeTask(task), aiEnabled: hasCredentials() });
  } catch (err) {
    next(err);
  }
});

deliverableRouter.post('/review', async (req, res, next) => {
  try {
    const task = requireTask(req, res);
    if (!task) return;

    const version = currentVersion(task);
    if (!version) {
      return res.status(409).json({ error: 'Não há arquivo enviado para revisar.' });
    }

    const buffer = await fs.readFile(resolveStored(version.storedName));
    const result = await reviewFile({
      buffer,
      filename: version.originalName,
      mimetype: version.mime,
      task,
    });

    const reviewId = crypto.randomUUID();
    let improvedFile = null;
    if (result.improvedContent) {
      improvedFile = `${reviewId}-melhorado-${safeName(version.originalName)}`;
      await fs.writeFile(resolveStored(improvedFile), result.improvedContent, 'utf8');
    }

    const review = {
      id: reviewId,
      version: version.version,
      createdAt: new Date().toISOString(),
      provider: result.provider,
      model: result.model,
      score: result.score,
      minScore: task.minScore,
      approvedByAi: result.approvedByAi,
      summary: result.summary,
      strengths: result.strengths,
      issues: result.issues,
      checklist: result.checklist,
      improvementNotes: result.improvementNotes,
      improvedFile,
      usage: result.usage,
    };

    task.deliverable.reviews.push(review);
    if (task.status === 'pendente' || task.status === 'em_andamento') {
      task.status = 'em_revisao';
    }
    task.updatedAt = new Date().toISOString();
    await save();

    res.json({ task: serializeTask(task), review: serializeReview(review, task) });
  } catch (err) {
    next(err);
  }
});

deliverableRouter.post('/reviews/:reviewId/apply', async (req, res, next) => {
  try {
    const task = requireTask(req, res);
    if (!task) return;

    const review = task.deliverable?.reviews.find((r) => r.id === req.params.reviewId);
    if (!review) return res.status(404).json({ error: 'Parecer não encontrado.' });
    if (!review.improvedFile) {
      return res.status(409).json({ error: 'Este parecer não gerou uma versão melhorada.' });
    }

    const source = await fs.readFile(resolveStored(review.improvedFile));
    const base = task.deliverable.versions.find((v) => v.version === review.version);
    const version = task.deliverable.currentVersion + 1;
    const originalName = improvedName(base?.originalName || task.deliverable.originalName);
    const storedName = `${task.id}-v${version}-${safeName(originalName)}`;
    await fs.writeFile(resolveStored(storedName), source);

    task.deliverable.currentVersion = version;
    task.deliverable.versions.push({
      version,
      storedName,
      originalName,
      mime: base?.mime || task.deliverable.mime,
      size: source.length,
      createdAt: new Date().toISOString(),
      source: 'ia',
    });
    if (task.status === 'concluida') task.status = 'em_revisao';
    task.updatedAt = new Date().toISOString();
    await save();

    res.status(201).json({ task: serializeTask(task) });
  } catch (err) {
    next(err);
  }
});

deliverableRouter.get('/versions/:version/download', async (req, res, next) => {
  try {
    const task = requireTask(req, res);
    if (!task) return;
    const version = task.deliverable?.versions.find(
      (v) => v.version === Number(req.params.version),
    );
    if (!version) return res.status(404).json({ error: 'Versão não encontrada.' });
    res.download(resolveStored(version.storedName), version.originalName);
  } catch (err) {
    next(err);
  }
});

deliverableRouter.get('/reviews/:reviewId/improved/download', async (req, res, next) => {
  try {
    const task = requireTask(req, res);
    if (!task) return;
    const review = task.deliverable?.reviews.find((r) => r.id === req.params.reviewId);
    if (!review?.improvedFile) {
      return res.status(404).json({ error: 'Não há versão melhorada para este parecer.' });
    }
    const base = task.deliverable.versions.find((v) => v.version === review.version);
    res.download(
      resolveStored(review.improvedFile),
      improvedName(base?.originalName || task.deliverable.originalName),
    );
  } catch (err) {
    next(err);
  }
});

function improvedName(name) {
  const ext = path.extname(name);
  return `${path.basename(name, ext)}-melhorado${ext}`;
}
