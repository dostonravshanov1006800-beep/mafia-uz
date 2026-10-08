/* Большая игра: 15 игроков, без лимита, адаптивные роли */
process.env.MAFIA_MEMORY = "1";
const assert = require("assert");
const bot = require("./bot.js");
let mid = 1;
global.fetch = async (url, opts) => {
  let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: ++mid, chat: { id: body.chat_id } } }) };
};
const C = -1000;
const mk = (i) => ({ id: 1000 + i, first_name: "Player" + i });
(async () => {
  await bot.handleUpdate({ update_id: 1, message: { chat: { id: C, type: "group" }, from: mk(1), text: "/start" } });
  for (let i = 2; i <= 15; i++) {
    await bot.handleUpdate({ update_id: i, callback_query: { id: "c" + i, from: mk(i), data: "j", message: { chat: { id: C, type: "group" }, message_id: 1 } } });
  }
  const g = bot.MEM.get(C);
  assert.equal(g.players.length, 15, "15 игроков без лимита");
  await bot.handleUpdate({ update_id: 99, callback_query: { id: "cs", from: mk(1), data: "s", message: { chat: { id: C, type: "group" }, message_id: 1 } } });
  const cnt = {};
  for (const p of g.players) cnt[p.role] = (cnt[p.role] || 0) + 1;
  // 15 игроков: мафия 5 (1 дон), докторов 3, комиссаров 2, мирных 5
  assert.deepEqual(cnt, { don: 1, mafia: 4, doctor: 3, sheriff: 2, civ: 5 }, "роли адаптированы: " + JSON.stringify(cnt));
  assert.equal(g.phase, "night", "ночь началась");
  console.log("✅ 15 игроков: мафия 5 (дон + 4), докторов 3, комиссаров 2, мирных 5 — без лимита");
})().catch(e => { console.error("❌", e.message); process.exit(1); });
