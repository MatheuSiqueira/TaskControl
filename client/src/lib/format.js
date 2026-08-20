export const COLUMNS = [
  { id: 'pendente', label: 'Pendente', color: '#6b7590' },
  { id: 'em_andamento', label: 'Em andamento', color: '#6b8afd' },
  { id: 'em_revisao', label: 'Em revisão', color: '#f0b429' },
  { id: 'concluida', label: 'Concluída', color: '#3ecf8e' },
];

export const PRIORITY_LABEL = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

export const DELIVERY_LABEL = {
  aguardando_arquivo: { text: 'Falta o arquivo', className: 'chip-locked', icon: '📎' },
  aguardando_revisao: { text: 'Aguardando revisão da IA', className: 'chip-locked', icon: '⏳' },
  aprovado: { text: 'Aprovado pela IA', className: 'chip-approved', icon: '✅' },
  reprovado: { text: 'Reprovado pela IA', className: 'chip-rejected', icon: '⚠️' },
};

export const SEVERITY_LABEL = {
  critico: 'Crítico',
  alto: 'Alto',
  medio: 'Médio',
  baixo: 'Baixo',
};

export function formatDate(value) {
  if (!value) return '—';
  const date = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function isOverdue(task) {
  if (!task.dueDate || task.status === 'concluida') return false;
  return task.dueDate < new Date().toISOString().slice(0, 10);
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function scoreColor(score) {
  if (score >= 85) return 'var(--ok)';
  if (score >= 60) return 'var(--warn)';
  return 'var(--danger)';
}
