import path from 'node:path';
import process from 'node:process';
import { google } from 'googleapis';
import { readJson } from './lib.mjs';

const root = process.cwd();
const config = await readJson(path.join(root, 'governance.config.json'));
const manifest = await readJson(path.join(root, config.generatedDirectory, 'release-manifest.json'));
const validation = await readJson(path.join(root, config.generatedDirectory, 'validation-report.json'), { releaseGate: 'UNKNOWN' });
const impact = await readJson(path.join(root, 'governance/impact-rules.json'), { rules: [] });
const secret = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const spreadsheetId = process.env.GOOGLE_SHEET_ID || config.spreadsheetId;
if (!secret) {
  console.log('Google Sheets sync skipped: GOOGLE_SERVICE_ACCOUNT_JSON is not configured.');
  process.exit(0);
}
const credentials = JSON.parse(secret);
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });

const schemas = {
  '总览仪表板': ['指标','当前值','状态','说明','最后更新'],
  '功能目录': ['功能ID','板块','功能名称','使用场景','触发条件','输入','核心处理','输出','对应模块','当前状态','来源版本','自动生成','人工确认','备注'],
  '代码索引': ['Symbol ID','所属板块','类型','原代码字串','中文用途','使用场景','触发方式','输入','输出','调用方','被调用对象','读取配置','写入目标','对应功能ID','来源文件','来源版本','起始行','结束行','代码哈希','当前状态','风险','优化建议','自动生成','人工确认','备注'],
  '依赖关系': ['关系ID','来源ID','关系类型','目标ID','所属功能','强制联动','来源文件','来源版本','状态','备注'],
  '契约表': ['契约ID','契约名称','类型','生产方','消费方','版本','必填字段','可选字段','Schema／格式','兼容策略','状态','来源文件','来源行','人工确认','备注'],
  '变更联动': ['规则ID','当它改变','必须检查／修改','影响功能','阻断等级','验证方式','当前状态','负责人','来源','备注'],
  '测试矩阵': ['测试ID','功能ID','场景','前置条件','输入样本','预期结果','实际结果','状态','自动／人工','来源版本','最后测试','证据链接','备注'],
  '优化路线图': ['事项ID','所属板块','项目','当前情况','发现来源','建议动作','影响','优先级','复杂度','风险等级','验收条件','负责人','当前状态','目标版本','来源版本','首次发现','最后更新','备注'],
  '同步日志': ['同步ID','时间','Git仓库','分支','Commit','脚本版本','Manifest版本','变更数量','测试结果','Sheet同步','状态','触发方式','备注']
};

function col(n) {
  let out = '';
  while (n) { n--; out = String.fromCharCode(65 + n % 26) + out; n = Math.floor(n / 26); }
  return out;
}

async function ensureTabs() {
  const response = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const map = new Map((response.data.sheets ?? []).map((s) => [s.properties.title, s.properties.sheetId]));
  const requests = Object.entries(schemas).filter(([title]) => !map.has(title)).map(([title, headers]) => ({
    addSheet: { properties: { title, gridProperties: { rowCount: 1000, columnCount: Math.max(5, headers.length), frozenRowCount: 2, hideGridlines: true } } }
  }));
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    const refreshed = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
    return new Map((refreshed.data.sheets ?? []).map((s) => [s.properties.title, s.properties.sheetId]));
  }
  return map;
}

async function init(title, headers) {
  const range = `'${title}'!A1:${col(headers.length)}2`;
  const old = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  if ((old.data.values?.[1] ?? []).join('|') === headers.join('|')) return;
  await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: [[title], headers] } });
}

async function upsert(title, items, idKey, mapRow, markRemoved = false) {
  const headers = schemas[title];
  const end = col(headers.length);
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${title}'!A2:${end}` });
  const rows = response.data.values ?? [];
  const liveHeaders = rows[0]?.length ? rows[0] : headers;
  const data = rows.slice(1);
  const index = new Map(data.map((row, i) => [String(row[0] ?? ''), i]).filter(([id]) => id));
  const incoming = new Set();
  const manual = new Set(config.manualColumns?.[title] ?? []);
  for (const item of items) {
    const id = String(item[idKey] ?? '');
    if (!id) continue;
    incoming.add(id);
    const mapped = mapRow(item);
    const pos = index.get(id);
    const old = pos === undefined ? [] : data[pos];
    const next = liveHeaders.map((header, i) => manual.has(header) && old[i] !== undefined && old[i] !== '' ? old[i] : (mapped[header] ?? ''));
    if (pos === undefined) { index.set(id, data.length); data.push(next); } else data[pos] = next;
  }
  if (markRemoved) {
    const status = liveHeaders.indexOf('当前状态');
    const auto = liveHeaders.indexOf('自动生成');
    for (const [id, pos] of index) if (!incoming.has(id) && (auto < 0 || String(data[pos][auto]).toUpperCase() === 'TRUE') && status >= 0) data[pos][status] = '已移除';
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `'${title}'!A2:${end}${Math.max(2, data.length + 2)}`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: [liveHeaders, ...data] }
  });
}

async function formatTabs(sheetMap) {
  const requests = [];
  for (const [title, headers] of Object.entries(schemas)) {
    const sheetId = sheetMap.get(title);
    const n = headers.length;
    requests.push(
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 2, hideGridlines: true } }, fields: 'gridProperties.frozenRowCount,gridProperties.hideGridlines' } },
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n }, cell: { userEnteredFormat: { backgroundColor: { red: .404, green: .306, blue: .655 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 14 }, verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat' } },
      { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: n }, cell: { userEnteredFormat: { backgroundColor: { red: .851, green: .824, blue: .914 }, textFormat: { bold: true }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat' } },
      { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: n }, cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy' } },
      { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 165 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: n }, properties: { pixelSize: title === '代码索引' ? 190 : 180 }, fields: 'pixelSize' } }
    );
  }
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

const sheetMap = await ensureTabs();
for (const [title, headers] of Object.entries(schemas)) await init(title, headers);

await upsert('功能目录', manifest.features ?? [], 'featureId', x => ({
  功能ID:x.featureId,板块:x.module,功能名称:x.name,使用场景:x.scenario,触发条件:x.trigger,输入:x.input,核心处理:x.process,输出:x.output,对应模块:x.module,当前状态:x.status,来源版本:x.sourceVersion,自动生成:x.autoGenerated?'TRUE':'FALSE',人工确认:x.manualConfirmed?'TRUE':'FALSE',备注:x.notes
}));
await upsert('代码索引', manifest.symbols ?? [], 'symbolId', x => ({
  'Symbol ID':x.symbolId,所属板块:x.module,类型:x.type,原代码字串:x.rawString,中文用途:x.purpose,使用场景:x.scenario,触发方式:x.trigger,输入:x.input,输出:x.output,调用方:(x.callers??[]).join(', '),被调用对象:(x.callees??[]).join(', '),读取配置:(x.readConfig??[]).join(', '),写入目标:(x.writeTargets??[]).join(', '),对应功能ID:x.featureId,来源文件:x.sourceFile,来源版本:x.sourceVersion,起始行:x.startLine,结束行:x.endLine,代码哈希:x.codeHash,当前状态:x.status,风险:x.risk,优化建议:x.optimization,自动生成:x.autoGenerated?'TRUE':'FALSE',人工确认:x.manualConfirmed?'TRUE':'FALSE',备注:x.notes
}), true);
await upsert('依赖关系', manifest.dependencies ?? [], 'relationshipId', x => ({关系ID:x.relationshipId,来源ID:x.sourceId,关系类型:x.relationType,目标ID:x.targetId,所属功能:x.featureId,强制联动:x.mandatoryCoupling?'TRUE':'FALSE',来源文件:x.sourceFile,来源版本:x.sourceVersion,状态:x.status,备注:x.notes}));
await upsert('契约表', manifest.contracts ?? [], 'contractId', x => ({契约ID:x.contractId,契约名称:x.name,类型:x.type,生产方:x.producer,消费方:x.consumer,版本:x.version,必填字段:x.requiredFields,可选字段:x.optionalFields,'Schema／格式':x.schema,兼容策略:x.compatibility,状态:x.status,来源文件:x.sourceFile,来源行:x.sourceLine,人工确认:x.manualConfirmed?'TRUE':'FALSE',备注:x.notes}));
await upsert('变更联动', impact.rules ?? [], 'ruleId', x => ({规则ID:x.ruleId,当它改变:x.changeTarget,'必须检查／修改':(x.mustCheck??[]).join('、'),影响功能:(x.affectedFeatures??[]).join('、'),阻断等级:x.gate,验证方式:x.verification,当前状态:x.status,来源:'governance/impact-rules.json'}));
await upsert('测试矩阵', manifest.tests ?? [], 'testId', x => ({测试ID:x.testId,功能ID:x.featureId,场景:x.scenario,前置条件:x.precondition,输入样本:x.inputSample,预期结果:x.expected,实际结果:x.actual,状态:x.status,'自动／人工':x.mode,来源版本:x.sourceVersion,最后测试:x.lastTest,证据链接:x.evidence,备注:x.notes}));
await upsert('优化路线图', manifest.roadmap ?? [], 'itemId', x => ({事项ID:x.itemId,所属板块:x.module,项目:x.title,当前情况:x.current??x.detail,发现来源:x.source??`${x.type??''} ${x.file??''}${x.line?`:${x.line}`:''}`.trim(),建议动作:x.action??x.suggestion,影响:x.impact??x.severity,优先级:x.priority,复杂度:x.complexity,风险等级:x.severity,验收条件:x.acceptance,负责人:x.owner,当前状态:x.status,目标版本:x.targetVersion,来源版本:x.sourceVersion,首次发现:x.firstDetected??x.firstDetectedAt,最后更新:x.updated??manifest.generatedAt,备注:x.notes}));

const now = manifest.generatedAt;
const dashboard = [
  ['源代码状态',manifest.sourceStatus,manifest.sourceStatus==='READY'?'正常':'待接入','唯一正式 .user.js 是否已纳入分析',now],
  ['功能数量',manifest.summary.featureCount,'自动统计','功能目录总数',now],
  ['代码 Symbol',manifest.summary.symbolCount,'自动统计','函数、类、选择器、API、URL 与 GM 存储键',now],
  ['依赖关系',manifest.summary.dependencyCount,'自动统计','已提取的调用关系',now],
  ['契约数量',manifest.summary.contractCount,'自动统计','跨 Tab、配置、内部数据与 API 契约',now],
  ['测试项目',manifest.summary.testCount??0,'自动统计','测试矩阵项目数',now],
  ['路线图事项',manifest.summary.optimizationCount,'自动统计','基础路线图与自动检测风险',now],
  ['发布门槛',validation.releaseGate,validation.releaseGate==='PASS'?'可发布':'不可发布','治理校验总结果',now]
];
await sheets.spreadsheets.values.update({spreadsheetId,range:`'总览仪表板'!A2:E${dashboard.length+2}`,valueInputOption:'USER_ENTERED',requestBody:{values:[schemas['总览仪表板'],...dashboard]}});
await sheets.spreadsheets.values.append({spreadsheetId,range:`'同步日志'!A:M`,valueInputOption:'USER_ENTERED',insertDataOption:'INSERT_ROWS',requestBody:{values:[[
  `SYNC-${Date.now()}`,now,manifest.repository,manifest.ref,manifest.commit,(manifest.sourceFiles??[]).map(f=>f.metadata?.version).filter(Boolean).join(', '),manifest.schemaVersion,(manifest.summary.symbolCount??0)+(manifest.summary.dependencyCount??0),validation.releaseGate,'完成','SUCCESS',process.env.GITHUB_ACTIONS?'GitHub Actions':'手动','自动字段已 Upsert；人工字段已保留'
]]}});
await formatTabs(sheetMap);
console.log(`Synced governance data to spreadsheet ${spreadsheetId}`);
