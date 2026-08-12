import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { glob } from 'glob';
import {
  classifyModule, getAnnotation, literalValue, normalizeSource, readJson,
  relativePosix, sha256, stableId, writeJson, writeText
} from './lib.mjs';

const traverse = traverseModule.default ?? traverseModule;
const root = process.cwd();
const config = await readJson(path.join(root, 'governance.config.json'));
const featureCatalog = await readJson(path.join(root, config.manualFeatureFile), { features: [] });
const manualContracts = await readJson(path.join(root, config.manualContractsFile), { contracts: [] });
const testCatalog = await readJson(path.join(root, config.manualTestFile), { tests: [] });
const manualRoadmap = await readJson(path.join(root, config.manualRoadmapFile), { items: [] });
const generatedDir = path.join(root, config.generatedDirectory);
const sourcePaths = await glob(config.sourceGlobs, {
  cwd: root, absolute: true, nodir: true, ignore: config.excludeGlobs
});

const symbolMap = new Map();
const relationships = new Map();
const autoContracts = new Map();
const autoRoadmap = new Map();
const sourceFiles = [];

function metadata(source) {
  const block = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
  const out = {};
  for (const line of block?.[1]?.split('\n') ?? []) {
    const match = line.match(/^\s*\/\/\s*@([^\s]+)\s+(.+?)\s*$/);
    if (match) out[match[1]] = out[match[1]] ? [].concat(out[match[1]], match[2]) : match[2];
  }
  return out;
}

function calleeName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
    const object = calleeName(node.object);
    const property = node.computed ? literalValue(node.property) : calleeName(node.property);
    return [object, property].filter(Boolean).join('.');
  }
  return '';
}

function functionName(pathRef) {
  const node = pathRef.node;
  if (node.id?.name) return node.id.name;
  const parent = pathRef.parentPath;
  if (parent?.isVariableDeclarator()) return parent.node.id?.name ?? '';
  if (parent?.isObjectProperty()) return parent.node.key?.name ?? parent.node.key?.value ?? '';
  return '';
}

function callerName(pathRef) {
  const fn = pathRef.getFunctionParent();
  if (!fn) return 'TOP_LEVEL';
  return functionName(fn) || `ANONYMOUS_L${fn.node.loc?.start.line ?? 0}`;
}

function addRoadmap(item) {
  const itemId = item.itemId ?? stableId('ROAD', `${item.file}:${item.line}:${item.type}:${item.title}`);
  autoRoadmap.set(itemId, {
    itemId, firstDetectedAt: new Date().toISOString(), status: '待研判', ...item
  });
}

function mergeUnique(primary, generated, key) {
  const map = new Map(primary.map((item) => [item[key], { ...item }]));
  for (const item of generated) {
    if (!map.has(item[key])) map.set(item[key], item);
    else {
      const existing = map.get(item[key]);
      for (const field of ['producer', 'consumer']) {
        if (!existing[field] && item[field]) existing[field] = item[field];
      }
    }
  }
  return [...map.values()];
}

for (const absolutePath of sourcePaths.sort()) {
  const sourceFile = relativePosix(root, absolutePath);
  const source = await readFile(absolutePath, 'utf8');
  const meta = metadata(source);
  let ast;
  try {
    ast = parse(source, {
      sourceType: 'unambiguous', errorRecovery: true, ranges: true,
      plugins: ['asyncGenerators', 'bigInt', 'classProperties', 'classPrivateProperties',
        'classPrivateMethods', 'dynamicImport', 'importMeta', 'logicalAssignment',
        'nullishCoalescingOperator', 'numericSeparator', 'objectRestSpread',
        'optionalCatchBinding', 'optionalChaining', 'topLevelAwait']
    });
  } catch (error) {
    addRoadmap({ type: 'PARSE_ERROR', title: `无法解析 ${sourceFile}`, detail: error.message,
      module: '核心', severity: 'CRITICAL', file: sourceFile, line: error.loc?.line ?? 0,
      suggestion: '修正语法错误后再发布。' });
    continue;
  }

  const localFunctions = new Map();
  const pendingCalls = [];
  const fingerprints = new Map();

  function register(type, name, node, purpose = '', rawString = '') {
    const annotation = getAnnotation(node, source);
    const resolvedName = name || `${type}@L${node.loc?.start.line ?? 0}`;
    const symbolId = annotation['gov-id'] || stableId(
      type === 'FUNCTION' ? 'FUNC' : type === 'CLASS' ? 'CLASS' : type.slice(0, 6),
      `${sourceFile}:${type}:${resolvedName}`
    );
    if (symbolMap.has(symbolId)) return symbolMap.get(symbolId);
    const raw = source.slice(node.start ?? 0, node.end ?? 0) || rawString;
    const symbol = {
      symbolId,
      module: annotation.module || classifyModule(sourceFile, resolvedName),
      type,
      rawString: rawString || resolvedName,
      name: resolvedName,
      purpose: annotation.purpose || purpose,
      scenario: '', trigger: '', input: '', output: '', callers: [], callees: [],
      readConfig: [], writeTargets: [], featureId: annotation.feature || '',
      sourceFile, sourceVersion: String(meta.version ?? ''),
      startLine: node.loc?.start.line ?? 0, endLine: node.loc?.end.line ?? 0,
      codeHash: sha256(normalizeSource(raw)).slice(0, 16), status: '使用中',
      risk: '', optimization: '', autoGenerated: true, manualConfirmed: false, notes: ''
    };
    symbolMap.set(symbolId, symbol);
    return symbol;
  }

  function addFunction(pathRef) {
    const name = functionName(pathRef);
    if (!name) return;
    const symbol = register('FUNCTION', name, pathRef.node);
    localFunctions.set(name, symbol.symbolId);
    const lines = symbol.endLine - symbol.startLine + 1;
    if (lines > config.longFunctionLines) {
      symbol.risk = '函数过长';
      symbol.optimization = '拆分为单一职责函数，并补齐模块边界与测试。';
      addRoadmap({ type: 'LONG_FUNCTION', title: `${name} 共 ${lines} 行`,
        detail: '长函数提高漏改与行为分叉风险。', module: symbol.module,
        severity: lines > config.longFunctionLines * 2 ? 'HIGH' : 'MEDIUM',
        file: sourceFile, line: symbol.startLine, symbolId: symbol.symbolId,
        suggestion: symbol.optimization });
    }
    const hash = sha256(normalizeSource(source.slice(pathRef.node.start, pathRef.node.end)));
    const group = fingerprints.get(hash) ?? [];
    group.push(symbol);
    fingerprints.set(hash, group);
  }

  traverse(ast, {
    FunctionDeclaration: addFunction,
    FunctionExpression: addFunction,
    ArrowFunctionExpression: addFunction,
    ClassDeclaration(pathRef) {
      register('CLASS', pathRef.node.id?.name ?? '', pathRef.node);
    },
    CallExpression(pathRef) {
      const call = calleeName(pathRef.node.callee);
      const caller = callerName(pathRef);
      pendingCalls.push({ call, caller, line: pathRef.node.loc?.start.line ?? 0 });
      const first = literalValue(pathRef.node.arguments?.[0]);
      if (typeof first !== 'string') return;
      if (call.endsWith('getElementById')) register('DOM_SELECTOR', `#${first}`, pathRef.node, 'DOM 元素 ID 选择器', `#${first}`);
      if (/(querySelector|querySelectorAll|closest)$/.test(call)) register('DOM_SELECTOR', first, pathRef.node, 'DOM CSS 选择器', first);
      if (/^(GM_|GM\.)?(getValue|setValue|addValueChangeListener|deleteValue)$/.test(call)) {
        const write = /(setValue|deleteValue)$/.test(call);
        register(write ? 'GM_STORAGE_WRITE' : 'GM_STORAGE_READ', first, pathRef.node, `${call} 使用的存储键`, first);
        const id = stableId('CONTRACT-GM', first);
        const old = autoContracts.get(id) ?? { contractId: id, name: first, type: 'GM_STORAGE', producer: '', consumer: '', version: '', requiredFields: '', optionalFields: '', schema: '待由正式代码推导', compatibility: '键名或数据结构改变时必须升级 schemaVersion 并处理旧缓存', status: '待确认', sourceFile, sourceLine: pathRef.node.loc?.start.line ?? 0, manualConfirmed: false, notes: '' };
        if (write) old.producer ||= caller; else old.consumer ||= caller;
        autoContracts.set(id, old);
      }
      if (call === 'fetch' || call.endsWith('.fetch')) {
        register('API_ENDPOINT', first, pathRef.node, 'HTTP API 请求端点', first);
        const id = stableId('CONTRACT-API', first);
        autoContracts.set(id, { contractId: id, name: first, type: 'HTTP_API', producer: '远端后台', consumer: caller, version: '', requiredFields: '', optionalFields: '', schema: '待由脱敏 HAR／fixture 推导', compatibility: '响应字段变化时更新标准化与契约测试', status: '待确认', sourceFile, sourceLine: pathRef.node.loc?.start.line ?? 0, manualConfirmed: false, notes: '' });
      }
    },
    StringLiteral(pathRef) {
      const value = pathRef.node.value;
      if (/^https?:\/\//i.test(value)) register('URL', value, pathRef.node, '硬编码网址；应确认是否改由配置管理', value);
      else if (/^\/(api\/|admin\d+\/|user\/|order\/)/i.test(value)) register('API_PATH', value, pathRef.node, '后台或 API 路径', value);
    }
  });

  for (const { call, caller, line } of pendingCalls) {
    const targetId = localFunctions.get(call);
    if (!targetId) continue;
    const sourceSymbol = [...symbolMap.values()].find((s) => s.sourceFile === sourceFile && s.name === caller);
    const sourceId = sourceSymbol?.symbolId ?? stableId('TOP', `${sourceFile}:${caller}`);
    const relationshipId = stableId('REL', `${sourceId}:CALLS:${targetId}:${line}`);
    relationships.set(relationshipId, { relationshipId, sourceId, relationType: 'CALLS', targetId,
      featureId: sourceSymbol?.featureId ?? '', mandatoryCoupling: false, sourceFile,
      sourceVersion: String(meta.version ?? ''), status: '使用中', notes: '' });
    if (sourceSymbol && !sourceSymbol.callees.includes(targetId)) sourceSymbol.callees.push(targetId);
    const target = symbolMap.get(targetId);
    if (target && !target.callers.includes(sourceId)) target.callers.push(sourceId);
  }

  for (const group of fingerprints.values()) {
    if (group.length < 2) continue;
    addRoadmap({ type: 'DUPLICATE_FUNCTION', title: `存在 ${group.length} 个完全相同函数区块`,
      detail: group.map((s) => `${s.name}@${s.startLine}`).join(', '), module: group[0].module,
      severity: 'HIGH', file: sourceFile, line: group[0].startLine,
      suggestion: '提取为单一共用实现，并让所有调用者引用同一 Symbol。' });
  }

  for (const match of source.matchAll(/\b(TODO|FIXME|HACK)\b[:：]?\s*([^\n]*)/gi)) {
    addRoadmap({ type: match[1].toUpperCase(), title: `${match[1].toUpperCase()}：${match[2].trim() || '未填说明'}`,
      detail: match[0].trim(), module: classifyModule(sourceFile, match[2]),
      severity: match[1].toUpperCase() === 'FIXME' ? 'HIGH' : 'MEDIUM',
      file: sourceFile, line: source.slice(0, match.index).split('\n').length,
      suggestion: '纳入路线图并补充验收条件。' });
  }

  const secretPatterns = [/(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}/ig,
    /(?:totp|otp|secret)\s*[:=]\s*['"][A-Z2-7]{12,}/ig,
    /(?:authorization|token)\s*[:=]\s*['"][^'"]{8,}/ig];
  for (const pattern of secretPatterns) for (const match of source.matchAll(pattern)) {
    addRoadmap({ type: 'POSSIBLE_SECRET', title: '检测到疑似硬编码敏感资料',
      detail: '值已隐藏，只记录位置。', module: '安全', severity: 'CRITICAL',
      file: sourceFile, line: source.slice(0, match.index).split('\n').length,
      suggestion: '立即移除并轮换凭证；改用安全存储。' });
  }

  sourceFiles.push({ path: sourceFile, size: source.length, hash: sha256(source), metadata: meta,
    symbolCount: [...symbolMap.values()].filter((s) => s.sourceFile === sourceFile).length });
}

const symbols = [...symbolMap.values()];
const dependencies = [...relationships.values()];
const contracts = mergeUnique(manualContracts.contracts ?? [], [...autoContracts.values()], 'contractId');
const optimizations = [...autoRoadmap.values()];
const roadmap = mergeUnique(manualRoadmap.items ?? [], optimizations, 'itemId');
const sourceStatus = sourcePaths.length ? 'READY' : 'WAITING_FOR_CANONICAL_SOURCE';
const manifest = {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY ?? config.repository,
  ref: process.env.GITHUB_REF_NAME ?? config.defaultBranch,
  commit: process.env.GITHUB_SHA ?? '', sourceStatus, sourceFiles,
  features: featureCatalog.features ?? [], symbols, dependencies, contracts,
  tests: testCatalog.tests ?? [], optimizations, roadmap,
  summary: {
    sourceFileCount: sourceFiles.length, featureCount: (featureCatalog.features ?? []).length,
    symbolCount: symbols.length, dependencyCount: dependencies.length, contractCount: contracts.length,
    testCount: (testCatalog.tests ?? []).length, optimizationCount: roadmap.length,
    criticalCount: optimizations.filter((item) => item.severity === 'CRITICAL').length,
    highCount: optimizations.filter((item) => item.severity === 'HIGH').length
  }
};

await writeJson(path.join(generatedDir, 'release-manifest.json'), manifest);
await writeJson(path.join(generatedDir, 'feature-map.json'), { schemaVersion: 1, features: manifest.features });
await writeJson(path.join(generatedDir, 'symbol-index.json'), { schemaVersion: 1, symbols });
await writeJson(path.join(generatedDir, 'dependency-graph.json'), { schemaVersion: 1, dependencies });
await writeJson(path.join(generatedDir, 'contracts.json'), { schemaVersion: 1, contracts });
await writeJson(path.join(generatedDir, 'tests.json'), { schemaVersion: 1, tests: manifest.tests });
await writeJson(path.join(generatedDir, 'optimization-items.json'), { schemaVersion: 1, optimizations });
await writeJson(path.join(generatedDir, 'roadmap.json'), { schemaVersion: 1, items: roadmap });
const diagram = ['# 自动生成的代码结构摘要', '', `- 生成时间：${manifest.generatedAt}`,
  `- 源代码状态：${sourceStatus}`, `- 源代码文件：${sourceFiles.length}`,
  `- 功能：${manifest.summary.featureCount}`, `- Symbol：${symbols.length}`,
  `- 依赖：${dependencies.length}`, `- 契约：${contracts.length}`,
  `- 测试：${manifest.summary.testCount}`, `- 路线图：${roadmap.length}`, '',
  '```mermaid', 'flowchart LR',
  ...dependencies.slice(0, 200).map((rel) => `  ${rel.sourceId.replace(/[^A-Za-z0-9_]/g, '_')} -->|${rel.relationType}| ${rel.targetId.replace(/[^A-Za-z0-9_]/g, '_')}`),
  '```', ''].join('\n');
await writeText(path.join(generatedDir, 'architecture.generated.md'), diagram);
console.log(JSON.stringify(manifest.summary, null, 2));
console.log(`sourceStatus=${sourceStatus}`);
