import { currentReview, currentVersion } from './store.js';

export const STATUSES = ['pendente', 'em_andamento', 'em_revisao', 'concluida'];

export const PRIORITIES = ['baixa', 'media', 'alta'];

/**
 * Motivos que impedem a tarefa de ser concluida.
 * Uma lista vazia significa que a conclusao esta liberada.
 */
/**
 * A aprovacao e recalculada a cada leitura contra a nota minima ATUAL da tarefa —
 * assim, mudar a exigencia na tarefa reavalia os pareceres ja existentes.
 */
export function reviewApproved(task, review) {
  return review.approvedByAi && review.score >= task.minScore;
}

export function completionBlockers(task) {
  if (!task.requiresFile) return [];

  const version = currentVersion(task);
  if (!version) {
    return ['Esta tarefa exige o envio de um arquivo, e nada foi enviado ainda.'];
  }

  // currentReview() ja considera apenas a versao atual: um parecer de versao
  // anterior nao vale, entao enviar arquivo novo derruba a aprovacao.
  const review = currentReview(task);
  if (!review) {
    return task.deliverable.reviews.length
      ? [
          `A versão ${task.deliverable.currentVersion} do arquivo ainda não foi revisada. ` +
            'Rode a revisão novamente.',
        ]
      : ['O arquivo enviado ainda não passou pela revisão da IA.'];
  }
  if (!reviewApproved(task, review)) {
    const reasons = [
      `A IA não aprovou o arquivo (nota ${review.score}, mínimo exigido ${task.minScore}).`,
    ];
    const serious = review.issues.filter(
      (i) => i.severity === 'critico' || i.severity === 'alto',
    );
    if (serious.length) {
      reasons.push(
        `Ainda há ${serious.length} ${serious.length === 1 ? 'problema grave' : 'problemas graves'} apontados no parecer.`,
      );
    }
    return reasons;
  }

  return [];
}

/** Status derivado de progresso, usado pela interface. */
export function deliveryState(task) {
  if (!task.requiresFile) return 'nao_exige_arquivo';
  const version = currentVersion(task);
  if (!version) return 'aguardando_arquivo';
  const review = currentReview(task);
  if (!review) return 'aguardando_revisao';
  return reviewApproved(task, review) ? 'aprovado' : 'reprovado';
}

/** Formato enviado ao frontend — nunca expoe caminhos de disco. */
export function serializeTask(task) {
  const blockers = completionBlockers(task);
  const d = task.deliverable;
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    assignee: task.assignee,
    priority: task.priority,
    dueDate: task.dueDate,
    status: task.status,
    requiresFile: task.requiresFile,
    fileCriteria: task.fileCriteria,
    minScore: task.minScore,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    canComplete: blockers.length === 0,
    blockers,
    deliveryState: deliveryState(task),
    deliverable: d
      ? {
          originalName: d.originalName,
          mime: d.mime,
          currentVersion: d.currentVersion,
          versions: d.versions.map((v) => ({
            version: v.version,
            originalName: v.originalName,
            size: v.size,
            createdAt: v.createdAt,
            source: v.source,
          })),
          reviews: d.reviews.map((r) => serializeReview(r, task)),
        }
      : null,
  };
}

export function serializeReview(review, task) {
  const { improvedFile, ...rest } = review;
  return {
    ...rest,
    minScore: task.minScore,
    approved: reviewApproved(task, review),
    hasImprovement: Boolean(improvedFile),
  };
}
