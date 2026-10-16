'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function modelSettings() {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
    return settings.env || {};
  } catch { return {}; }
}

async function askModel(system, payload, maxTokens) {
  const settings = modelSettings();
  const base = settings.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL;
  const token = settings.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN;
  const model = String(settings.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || '').replace(/\[1M\]$/, '');
  if (!base || !token || !model) throw new Error('未配置话题归纳模型（ANTHROPIC_BASE_URL / AUTH_TOKEN / MODEL）。');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  let response;
  try {
    response = await fetch(base.replace(/\/$/, '') + '/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature: 0, thinking: { type: 'disabled' },
        system,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      }),
    });
  } finally { clearTimeout(timer); }
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw new Error(`话题归纳服务返回 ${response.status}：${String(failure.error?.message || failure.message || '').slice(0, 700)}`);
  }
  const json = await response.json();
  const raw = (json.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); }
  catch { throw new Error(`话题归纳服务返回格式无法解析（停止原因：${json.stop_reason || '未知'}；文本长度：${raw.length}）。`); }
  return parsed;
}

/** 显式交易/代练广告先剔除；其余帖子再依据正文判断是否真正讨论游戏内容。 */
function isObviousCommercial(note) {
  const title = String(note.title || '').replace(/\s+/g, '');
  const body = String(note.content || '').replace(/\s+/g, '');
  const text = `${title} ${body}`;
  if (/(接单|出号|卖号|收号|买号|账号交易|铜币买卖|收铜|出铜|卖铜|买铜|低价出售|有偿服务)/i.test(title)) return true;
  if (/(铜币|游戏币|金锭|银两).{0,12}(出售|收购|买卖|回收|换米|换钱|代充)|(?:出售|收购|买卖|回收).{0,12}(铜币|游戏币|金锭|银两)/i.test(text)) return true;
  if (/(代打|代肝|代练|陪玩|带打).{0,18}(接单|包过|私信|收费|有偿|联系)|(接单|包过|私信|收费|有偿|联系).{0,18}(代打|代肝|代练|陪玩|带打)/i.test(text)) return true;
  return false;
}

async function selectGameDiscussions(game, notes) {
  if (!notes.length) return [];
  const candidates = notes.filter((n) => !isObviousCommercial(n));
  if (!candidates.length) return [];
  const input = candidates.map((n, i) => ({ id: i + 1, title: n.title, content: String(n.content || '').slice(0, 1800) }));
  const parsed = await askModel(
    '你是游戏内容研究员。逐篇判断帖子是否在讨论指定游戏本身的内容。有效：玩法、副本、剧情、角色、活动、版本更新、外观、玩家体验、游戏内机制和围绕这些内容的真实讨论；讨论交易机制或代练现象对游戏的影响，也属于游戏讨论。无效：提供代打、代肝、代练、陪玩服务，账号或道具买卖，玩家直接发布铜币/游戏币收售交易，推广服务，招揽生意，单纯促销，无关游戏的内容。即使广告里出现游戏名也必须判无效。只根据给定标题和正文判断；无法确认是游戏内容讨论时判无效。只输出 JSON：{"validIds":[1,2]}，编号仅来自输入，不要解释。',
    { game, notes: input }, 1500);
  if (!Array.isArray(parsed.validIds)) throw new Error('有效帖子筛选结果格式错误。');
  const ids = [...new Set(parsed.validIds.map(Number))];
  if (ids.some((id) => !Number.isInteger(id) || id < 1 || id > candidates.length))
    throw new Error('有效帖子筛选返回了无效编号。');
  return ids.map((id) => candidates[id - 1]);
}

/** 把真实搜索结果归纳为话题；模型只负责分类与文字归纳，排名由可核查的帖子数计算。 */
async function summarizeTopics(game, notes) {
  if (notes.length !== 30) throw new Error(`${game} 需要恰好 30 篇有效游戏讨论帖，当前只有 ${notes.length} 篇。`);
  const input = notes.map((n, i) => ({
    id: i + 1,
    title: n.title,
    content: String(n.content || '').slice(0, 1800),
  }));
  const parsed = await askModel(
    '你是游戏营销研究员。只依据给定的 30 篇有效游戏讨论帖标题和正文归纳玩家讨论话题。不要创造帖子里没有的观点。将语义相近的帖子合并成明确、具体的话题，每条帖子必须归入一个话题。仅输出 JSON，不要 Markdown。格式：{"topics":[{"name":"话题名","summary":"一句话总结讨论内容","postIds":[1,2]}]}。返回 3 到 10 个话题，每个帖子编号恰好出现一次。',
    { game, notes: input }, 4000);
  if (!Array.isArray(parsed.topics)) throw new Error('话题归纳服务未返回话题列表。');

  // 模型有时返回有效 JSON，却漏掉个别编号；单独补分，确保 30 篇都参加讨论度计算。
  const assigned = new Set();
  for (const topic of parsed.topics) {
    topic.postIds = [...new Set((Array.isArray(topic.postIds) ? topic.postIds : []).map(Number))]
      .filter((id) => Number.isInteger(id) && id >= 1 && id <= notes.length && !assigned.has(id));
    topic.postIds.forEach((id) => assigned.add(id));
  }
  const missing = input.filter((n) => !assigned.has(n.id));
  if (missing.length) {
    const supplement = await askModel(
      '把尚未归类的有效游戏讨论帖分到已有话题中。不得新增话题；每个输入帖子编号必须出现一次。仅输出 JSON：{"assignments":[{"id":1,"topicIndex":1}]}。topicIndex 从 1 开始，对应给定话题列表。',
      { game, topics: parsed.topics.map((t, i) => ({ topicIndex: i + 1, name: t.name, summary: t.summary })), notes: missing }, 1500);
    if (!Array.isArray(supplement.assignments)) throw new Error('漏分帖子补充分组格式错误。');
    for (const row of supplement.assignments) {
      const id = Number(row.id);
      const index = Number(row.topicIndex) - 1;
      if (!Number.isInteger(id) || !Number.isInteger(index) || index < 0 || index >= parsed.topics.length || assigned.has(id) || !missing.some((n) => n.id === id)) continue;
      parsed.topics[index].postIds.push(id);
      assigned.add(id);
    }
  }
  if (assigned.size !== notes.length) throw new Error(`30 篇帖子中有 ${notes.length - assigned.size} 篇未能归入话题，本次结果未保存。`);

  const used = new Set();
  const topics = parsed.topics.map((t) => {
    const ids = [...new Set(Array.isArray(t.postIds) ? t.postIds.map(Number) : [])]
      .filter((id) => Number.isInteger(id) && id >= 1 && id <= notes.length && !used.has(id));
    ids.forEach((id) => used.add(id));
    const group = ids.map((id) => notes[id - 1]);
    return {
      title: String(t.name || '').trim().slice(0, 80),
      summary: String(t.summary || '').trim().slice(0, 300),
      postCount: group.length,
      commentTotal: group.reduce((sum, n) => sum + parseCount(n.noteCommentCount), 0),
      evidence: group.slice(0, 5).map((n) => ({ title: n.title, link: n.link })),
      representative: group[0],
    };
  }).filter((t) => t.title && t.summary && t.postCount > 0);
  if (topics.length < 3) throw new Error('有效讨论话题不足 3 个，本次结果未保存。');
  if (used.size !== notes.length) throw new Error('话题归纳未覆盖全部 30 篇帖子，本次结果未保存。');
  topics.sort((a, b) => b.postCount - a.postCount || b.commentTotal - a.commentTotal);
  return topics.slice(0, 3);
}

function parseCount(s) {
  const m = String(s || '').replace(/\s+/g, '').match(/^(\d+(?:\.\d+)?)(万|w|W|亿)?$/);
  if (!m) return 0;
  return Number(m[1]) * (m[2] === '亿' ? 1e8 : m[2] ? 1e4 : 1);
}

module.exports = { summarizeTopics, selectGameDiscussions, isObviousCommercial };
