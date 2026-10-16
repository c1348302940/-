'use strict';

const assert = require('node:assert/strict');
const { isObviousCommercial, selectGameDiscussions, summarizeTopics } = require('../lib/competitor-topics');

for (const title of ['逆水寒代肝接单', '一梦江湖代打包过', '逆水寒铜币交易 出售', '天刀收铜币换米', '倩女幽魂卖号']) {
  assert.equal(isObviousCommercial({ title }), true, `${title} 应被排除`);
}
for (const title of ['逆水寒新副本打法讨论', '一梦江湖剧情更新', '天涯明月刀手游时装评价', '铜币交易机制调整讨论', '代肝现象对游戏公平性的影响']) {
  assert.equal(isObviousCommercial({ title }), false, `${title} 应继续参与正文筛选`);
}

(async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const input = JSON.parse(options.body);
    assert.equal(input.messages[0].role, 'user');
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ validIds: [1, 3] }) }] }) };
  };
  try {
    const notes = [
      { title: '逆水寒副本机制', content: '讨论机制' },
      { title: '逆水寒代肝接单', content: '收费服务' },
      { title: '逆水寒无关自拍', content: '照片' },
      { title: '逆水寒新角色', content: '讨论角色' },
    ];
    const selected = await selectGameDiscussions('逆水寒手游', notes);
    assert.deepEqual(selected.map((n) => n.title), ['逆水寒副本机制', '逆水寒新角色']);
    await assert.rejects(() => summarizeTopics('逆水寒手游', selected), /30 篇/);
    let calls = 0;
    global.fetch = async () => {
      calls++;
      const payload = calls === 1
        ? { topics: [
          { name: '玩法', summary: '玩法讨论', postIds: Array.from({ length: 9 }, (_, i) => i + 1) },
          { name: '剧情', summary: '剧情讨论', postIds: Array.from({ length: 9 }, (_, i) => i + 10) },
          { name: '外观', summary: '外观讨论', postIds: Array.from({ length: 9 }, (_, i) => i + 19) },
        ] }
        : { assignments: [{ id: 28, topicIndex: 1 }, { id: 29, topicIndex: 2 }, { id: 30, topicIndex: 3 }] };
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] }) };
    };
    const thirty = Array.from({ length: 30 }, (_, i) => ({ title: `游戏内容 ${i + 1}`, content: '玩家讨论', link: `https://example.com/${i + 1}` }));
    const topics = await summarizeTopics('逆水寒手游', thirty);
    assert.equal(calls, 2);
    assert.equal(topics.reduce((total, t) => total + t.postCount, 0), 30);
    console.log('商业帖剔除、模型筛选映射、30 篇门槛：通过');
  } finally { global.fetch = originalFetch; }
})().catch((e) => { console.error(e); process.exitCode = 1; });
