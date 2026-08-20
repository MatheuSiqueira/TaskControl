/**
 * Backend do TaskControl rodando dentro do navegador, para a versao publicada
 * como demonstracao. Usa as MESMAS regras do servidor — gate.js decide a trava de
 * conclusao e demoReviewer.js faz a verificacao — trocando disco e banco por Map.
 *
 * A unica coisa que nao roda aqui e a chamada a API da Anthropic: a pagina publicada
 * nao tem como falar com a API, entao a revisao usa o verificador local. A tarefa de
 * exemplo carrega um parecer real ja escrito, para mostrar o formato da saida.
 */
import { serializeReview, serializeTask } from '../../../server/src/lib/gate.js';
import { demoReview } from '../../../server/src/ai/demoReviewer.js';
import { classify, extname } from '../../../server/src/lib/files.js';
import { EXEMPLO } from './demoSeed.js';

const tasks = [];
const blobs = new Map(); // storedName -> conteudo (string ou ArrayBuffer)

/** classify() espera um Buffer do Node; no navegador bastam toString() e length. */
const asBuffer = (text, byteLength) => ({ toString: () => text, length: byteLength });

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function seed() {
  const exemplo = {
    id: uid(),
    title: 'Relatório mensal de vendas',
    description:
      'Consolidar os números de vendas do mês e enviar o relatório em Markdown para revisão.',
    assignee: 'Equipe Comercial',
    priority: 'alta',
    dueDate: inDays(5),
    status: 'em_revisao',
    requiresFile: true,
    fileCriteria:
      'O relatório deve conter: título, período analisado, tabela com receita por produto, ' +
      'comparativo com o mês anterior em porcentagem e uma conclusão com próximos passos. ' +
      'Verifique erros de português, números inconsistentes e falta de contexto.',
    minScore: 75,
    deliverable: {
      originalName: 'relatorio-vendas-julho.md',
      mime: 'text/markdown',
      currentVersion: 1,
      versions: [
        {
          version: 1,
          storedName: 'exemplo-v1',
          originalName: 'relatorio-vendas-julho.md',
          mime: 'text/markdown',
          size: new Blob([EXEMPLO.arquivo]).size,
          createdAt: now(),
          source: 'upload',
        },
      ],
      reviews: [
        {
          ...EXEMPLO.parecer,
          id: uid(),
          version: 1,
          createdAt: now(),
          improvedFile: 'exemplo-v1-melhorado',
        },
      ],
    },
    createdAt: now(),
    updatedAt: now(),
  };
  blobs.set('exemplo-v1', EXEMPLO.arquivo);
  blobs.set('exemplo-v1-melhorado', EXEMPLO.melhorado);

  tasks.push(
    exemplo,
    {
      id: uid(),
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
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: uid(),
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
      createdAt: now(),
      updatedAt: now(),
    },
  );
}
seed();

function find(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error('Tarefa não encontrada.');
  return task;
}

function fail(message, extra = {}) {
  const error = new Error(message);
  Object.assign(error, extra);
  throw error;
}

/** Entrega o arquivo ao visitante usando a capability de downloads da pagina. */
async function save(filename, data) {
  const downloads = await window.claude?.use?.('downloads');
  if (!downloads) {
    fail('O download não está disponível nesta visualização.');
  }
  await downloads.save({ filename, data });
}

export const api = {
  health: async () => ({ aiEnabled: false, model: 'demonstração', demo: true }),

  listTasks: async () => ({ tasks: tasks.map(serializeTask) }),

  createTask: async (data) => {
    if (!data.title?.trim()) fail('O título da tarefa é obrigatório.');
    const task = {
      id: uid(),
      title: data.title.trim(),
      description: data.description ?? '',
      assignee: data.assignee ?? '',
      priority: data.priority ?? 'media',
      dueDate: data.dueDate ?? '',
      status: 'pendente',
      requiresFile: Boolean(data.requiresFile),
      fileCriteria: data.fileCriteria ?? '',
      minScore: Number(data.minScore) || 70,
      deliverable: null,
      createdAt: now(),
      updatedAt: now(),
    };
    tasks.unshift(task);
    return { task: serializeTask(task) };
  },

  updateTask: async (id, data) => {
    const task = find(id);
    // Mesma trava do servidor: o status so vai para "concluida" se o gate liberar.
    if (data.status === 'concluida') {
      const view = serializeTask(task);
      if (!view.canComplete) {
        fail('Esta tarefa ainda não pode ser concluída.', {
          status: 409,
          blockers: view.blockers,
          task: view,
        });
      }
    }
    Object.assign(task, data, { minScore: Number(data.minScore ?? task.minScore) });
    task.updatedAt = now();
    return { task: serializeTask(task) };
  },

  deleteTask: async (id) => {
    const index = tasks.findIndex((t) => t.id === id);
    if (index >= 0) tasks.splice(index, 1);
    return { ok: true };
  },

  uploadFile: async (id, file) => {
    const task = find(id);
    const text = await file.text();
    const parsed = classify(asBuffer(text, file.size), file.name, file.type);
    if (parsed.kind === 'unsupported') fail(parsed.reason, { status: 415 });
    if (parsed.kind !== 'text') {
      fail(
        'Esta demonstração revisa apenas arquivos de texto (.md, .txt, .csv, .json, código). ' +
          'PDF e imagem funcionam no app completo, onde a IA lê o arquivo.',
        { status: 415 },
      );
    }

    if (!task.deliverable) {
      task.deliverable = {
        originalName: file.name,
        mime: file.type,
        currentVersion: 0,
        versions: [],
        reviews: [],
      };
    }

    const version = task.deliverable.currentVersion + 1;
    const storedName = `${task.id}-v${version}`;
    blobs.set(storedName, text);

    task.deliverable.originalName = file.name;
    task.deliverable.mime = file.type;
    task.deliverable.currentVersion = version;
    task.deliverable.versions.push({
      version,
      storedName,
      originalName: file.name,
      mime: file.type,
      size: file.size,
      createdAt: now(),
      source: 'upload',
    });

    if (task.status === 'concluida') task.status = 'em_revisao';
    task.updatedAt = now();
    return { task: serializeTask(task), aiEnabled: false };
  },

  review: async (id) => {
    const task = find(id);
    const d = task.deliverable;
    if (!d) fail('Não há arquivo enviado para revisar.');

    const version = d.versions.find((v) => v.version === d.currentVersion);
    const text = blobs.get(version.storedName);

    await delay(900); // deixa o estado de "revisando" visivel, como na chamada real

    const result = demoReview({
      parsed: { kind: 'text', text },
      filename: version.originalName,
      task,
    });

    const reviewId = uid();
    let improvedFile = null;
    if (result.improvedContent) {
      improvedFile = `${reviewId}-melhorado`;
      blobs.set(improvedFile, result.improvedContent);
    }

    const review = {
      id: reviewId,
      version: version.version,
      createdAt: now(),
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
      usage: null,
    };

    d.reviews.push(review);
    if (task.status === 'pendente' || task.status === 'em_andamento') task.status = 'em_revisao';
    task.updatedAt = now();
    return { task: serializeTask(task), review: serializeReview(review, task) };
  },

  applyImprovement: async (id, reviewId) => {
    const task = find(id);
    const d = task.deliverable;
    const review = d?.reviews.find((r) => r.id === reviewId);
    if (!review?.improvedFile) fail('Este parecer não gerou uma versão melhorada.');

    const base = d.versions.find((v) => v.version === review.version);
    const version = d.currentVersion + 1;
    const ext = extname(base.originalName);
    const originalName = `${base.originalName.slice(0, -ext.length || undefined)}-melhorado${ext}`;
    const storedName = `${task.id}-v${version}`;
    const content = blobs.get(review.improvedFile);
    blobs.set(storedName, content);

    d.currentVersion = version;
    d.versions.push({
      version,
      storedName,
      originalName,
      mime: base.mime,
      size: new Blob([content]).size,
      createdAt: now(),
      source: 'ia',
    });
    if (task.status === 'concluida') task.status = 'em_revisao';
    task.updatedAt = now();
    return { task: serializeTask(task) };
  },

  downloadVersion: async (id, version) => {
    const task = find(id);
    const v = task.deliverable.versions.find((item) => item.version === version);
    await save(v.originalName, blobs.get(v.storedName));
  },

  downloadImproved: async (id, reviewId) => {
    const task = find(id);
    const review = task.deliverable.reviews.find((r) => r.id === reviewId);
    const base = task.deliverable.versions.find((v) => v.version === review.version);
    const ext = extname(base.originalName);
    await save(
      `${base.originalName.slice(0, -ext.length || undefined)}-melhorado${ext}`,
      blobs.get(review.improvedFile),
    );
  },
};
