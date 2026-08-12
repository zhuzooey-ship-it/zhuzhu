import path from 'node:path';
import process from 'node:process';
import { readJson, writeJson, writeText } from './lib.mjs';

const root = process.cwd();
const config = await readJson(path.join(root, 'governance.config.json'));
const manifest = await readJson(path.join(root, config.generatedDirectory, 'release-manifest.json'));
const impact = await readJson(path.join(root, 'governance/impact-rules.json'), { rules: [] });
const strict = String(process.env.GOVERNANCE_STRICT ?? 'false').toLowerCase() === 'true';
const findings = [];

function add(level, code, message, details = {}) {
  findings.push({ level, code, message, ...details });
}

function duplicateValues(items, key) {
  const seen = new Map();
  for (const item of items) {
    const value = item[key];
    const group = seen.get(value) ?? [];
    group.push(item);
    seen.set(value, group);
  }
  return [...seen.entries()].filter(([, group]) => group.length > 1);
}

if (manifest.sourceStatus !== 'READY') {
  add('BLOCK', 'SOURCE_MISSING', '尚未放入唯一正式 Userscript；治理框架已就绪，但不可发布。');
}

for (const [id, group] of duplicateValues(manifest.symbols, 'symbolId')) {
  add('BLOCK', 'DUPLICATE_SYMBOL_ID', `Symbol ID 重复：${id}`, { count: group.length });
}
for (const [id, group] of duplicateValues(manifest.features, 'featureId')) {
  add('BLOCK', 'DUPLICATE_FEATURE_ID', `Feature ID 重复：${id}`, { count: group.length });
}

const featureIds = new Set(manifest.features.map((item) => item.featureId));
const symbolIds = new Set(manifest.symbols.map((item) => item.symbolId));
for (const symbol of manifest.symbols) {
  if (symbol.featureId && !featureIds.has(symbol.featureId)) {
    add('WARN', 'UNKNOWN_FEATURE', `${symbol.symbolId} 指向不存在的功能 ${symbol.featureId}`, { file: symbol.sourceFile, line: symbol.startLine });
  }
}
for (const rel of manifest.dependencies) {
  if (!symbolIds.has(rel.targetId)) add('WARN', 'MISSING_TARGET', `${rel.relationshipId} 的目标 Symbol 不存在：${rel.targetId}`);
}

const storageContracts = manifest.contracts.filter((item) => item.type === 'GM_STORAGE');
for (const contract of storageContracts) {
  if (!contract.producer) add('WARN', 'STORAGE_NO_PRODUCER', `GM 存储键 ${contract.name} 未检测到写入端。`);
  if (!contract.consumer) add('WARN', 'STORAGE_NO_CONSUMER', `GM 存储键 ${contract.name} 未检测到读取／监听端。`);
}

for (const item of manifest.optimizations) {
  if (item.severity === 'CRITICAL') add('BLOCK', item.type, item.title, { file: item.file, line: item.line });
  else if (item.severity === 'HIGH') add('WARN', item.type, item.title, { file: item.file, line: item.line });
}

if (!(impact.rules ?? []).length) add('WARN', 'NO_IMPACT_RULES', '没有变更联动规则。');

const blocked = findings.some((item) => item.level === 'BLOCK');
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceStatus: manifest.sourceStatus,
  releaseGate: blocked ? 'BLOCKED' : 'PASS',
  strict,
  summary: {
    block: findings.filter((item) => item.level === 'BLOCK').length,
    warn: findings.filter((item) => item.level === 'WARN').length,
    info: findings.filter((item) => item.level === 'INFO').length
  },
  findings
};
await writeJson(path.join(root, config.generatedDirectory, 'validation-report.json'), report);
await writeText(
  path.join(root, config.generatedDirectory, 'validation-report.md'),
  ['# 治理验证报告', '', `- Release Gate：**${report.releaseGate}**`, `- BLOCK：${report.summary.block}`, `- WARN：${report.summary.warn}`, '', ...findings.map((item) => `- [${item.level}] ${item.code}：${item.message}`), ''].join('\n')
);

console.log(JSON.stringify(report.summary, null, 2));
console.log(`releaseGate=${report.releaseGate}`);
if (strict && blocked && manifest.sourceStatus === 'READY') process.exitCode = 1;
