import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function sha1(value) {
  return createHash('sha1').update(String(value)).digest('hex');
}

export function stableId(prefix, value) {
  return `${prefix}-${sha1(value).slice(0, 10).toUpperCase()}`;
}

export function normalizeSource(value) {
  return String(value)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

export function relativePosix(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

export function literalValue(node) {
  if (!node) return undefined;
  if (node.type === 'StringLiteral' || node.type === 'Literal') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
  }
  return undefined;
}

export function getAnnotation(node, source) {
  const comments = [
    ...(node.leadingComments ?? []),
    ...(node.innerComments ?? [])
  ].map((comment) => comment.value).join('\n');
  const out = {};
  for (const key of ['gov-id', 'feature', 'module', 'purpose']) {
    const match = comments.match(new RegExp(`@${key}\\s+([^\\n*]+)`));
    if (match) out[key] = match[1].trim();
  }
  if (!out.purpose && node.loc) {
    const before = source.slice(0, node.start ?? 0).split('\n').slice(-3).join(' ');
    const match = before.match(/\/\/\s*([^\n]{4,120})\s*$/);
    if (match) out.purpose = match[1].trim();
  }
  return out;
}

export function classifyModule(filePath, name = '') {
  const text = `${filePath} ${name}`.toLowerCase();
  const rules = [
    ['OCR', ['ocr', 'tesseract', 'receipt', 'paidtime', 'paymenttime']],
    ['跨 Tab', ['bridge', 'worker', 'cross-tab', 'crosstab', 'gm_addvaluechangelistener']],
    ['平台路由', ['route', 'platform', 'alias', 'adapter']],
    ['查单', ['order', 'match', 'query', 'vip', 'point']],
    ['会员资料', ['user', 'member', 'uid', 'registerip', 'loginip']],
    ['配置', ['config', 'cache', 'sheet']],
    ['会话识别', ['context', 'conversation', 'session']],
    ['UI', ['render', 'panel', 'modal', 'toast', 'button']],
    ['安全', ['credential', 'secret', 'token', 'password', 'totp']]
  ];
  for (const [module, words] of rules) {
    if (words.some((word) => text.includes(word))) return module;
  }
  return '核心';
}
