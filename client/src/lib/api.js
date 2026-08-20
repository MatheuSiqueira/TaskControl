/** Cliente HTTP da API. Erros viram Error com a mensagem que o servidor mandou. */
async function request(url, options = {}) {
  const response = await fetch(url, options);
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(body?.error || `Falha na requisição (${response.status}).`);
    error.status = response.status;
    error.blockers = body?.blockers || [];
    error.task = body?.task || null;
    throw error;
  }
  return body;
}

const json = (method, data) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export const api = {
  health: () => request('/api/health'),
  listTasks: () => request('/api/tasks'),
  createTask: (data) => request('/api/tasks', json('POST', data)),
  updateTask: (id, data) => request(`/api/tasks/${id}`, json('PATCH', data)),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),

  uploadFile: (id, file) => {
    const form = new FormData();
    form.append('file', file);
    return request(`/api/tasks/${id}/deliverable`, { method: 'POST', body: form });
  },
  review: (id) => request(`/api/tasks/${id}/deliverable/review`, { method: 'POST' }),
  applyImprovement: (id, reviewId) =>
    request(`/api/tasks/${id}/deliverable/reviews/${reviewId}/apply`, { method: 'POST' }),

  downloadVersion: (id, version) =>
    triggerDownload(`/api/tasks/${id}/deliverable/versions/${version}/download`),
  downloadImproved: (id, reviewId) =>
    triggerDownload(`/api/tasks/${id}/deliverable/reviews/${reviewId}/improved/download`),
};

/** O servidor responde com Content-Disposition: attachment, entao a pagina nao navega. */
function triggerDownload(url) {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
