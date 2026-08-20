/** Extensoes tratadas como texto puro — sao as unicas que a IA consegue reescrever. */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml', '.xml',
  '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go',
  '.java', '.c', '.h', '.cpp', '.cs', '.php', '.sql', '.sh', '.ini', '.env',
  '.log', '.rst', '.tex', '.srt', '.conf', '.toml',
]);

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Limite de conteudo enviado a IA (caracteres). */
export const MAX_TEXT_CHARS = 400_000;

/** Acima disso o arquivo nao recebe versao melhorada (limite de tokens de saida). */
export const MAX_IMPROVE_CHARS = 120_000;

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Classifica o arquivo enviado em um dos modos que a revisao sabe tratar.
 * @returns {{kind: 'text'|'pdf'|'image'|'unsupported', text?: string, mediaType?: string, reason?: string}}
 */
export function classify(buffer, filename, mimetype) {
  const ext = extname(filename).toLowerCase();
  const mime = (mimetype || '').toLowerCase();

  if (mime === 'application/pdf' || ext === '.pdf') {
    return { kind: 'pdf', mediaType: 'application/pdf' };
  }

  if (IMAGE_MIMES.has(mime)) {
    return { kind: 'image', mediaType: mime };
  }

  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/') || mime === 'application/json') {
    const text = buffer.toString('utf8');
    if (looksBinary(text)) {
      return { kind: 'unsupported', reason: 'O arquivo parece binário e não pôde ser lido como texto.' };
    }
    return { kind: 'text', text: text.slice(0, MAX_TEXT_CHARS) };
  }

  // Ultima tentativa: se decodifica limpo como UTF-8, tratamos como texto.
  const text = buffer.toString('utf8');
  if (buffer.length > 0 && !looksBinary(text)) {
    return { kind: 'text', text: text.slice(0, MAX_TEXT_CHARS) };
  }

  return {
    kind: 'unsupported',
    reason:
      `Não sei revisar arquivos "${ext || mime || 'desconhecidos'}". ` +
      'Envie texto (.md, .txt, .csv, .json, código), PDF ou imagem (PNG/JPG).',
  };
}

/** Extensao do arquivo, com o ponto. Sem node:path, para rodar tambem no navegador. */
export function extname(filename) {
  const match = /\.[^./\\]+$/.exec(filename || '');
  return match ? match[0] : '';
}

/** Heuristica: bytes nulos ou muitos caracteres de substituicao indicam binario. */
function looksBinary(text) {
  const sample = text.slice(0, 4000);
  if (sample.includes('\u0000')) return true;
  const replacements = (sample.match(/\uFFFD/g) || []).length;
  return replacements > sample.length * 0.02;
}

/** Nome de arquivo seguro para gravar em disco. */
export function safeName(name) {
  return (name || 'arquivo')
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}
