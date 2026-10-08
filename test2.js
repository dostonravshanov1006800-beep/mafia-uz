/* Таймеры: все молчат — фазы сменяются по дедлайну, игра не зависает */
process.env.MAFIA_MEMORY = "1";
const assert = require("assert");
const bot = require("./bot.js");
let SENT = [], mid = 1;
global.fetch = async (url, opts) => {
  let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
  SENT.push(body);
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: ++mid, chat: { id: body.chat_id } } }) };
};
const C = -555, mk = (id, n) => ({ id, first_name: n });
(async () => {
  await bot.handleUpdate({ update_id: 1, message: { chat: { id: C, type: "group" }, from: mk(1, "A"), text: "/start" } });
  for (const id of [2, 3, 4]) await bot.handleUpdate({ update_id: id, callback_query: { id: "c" + id, from: mk(id, "P" + id), data: "j", message: { chat: { id: C, type: "group" }, message_id: 1 } } });
  const g = bot.MEM.get(C);
  await bot.handleUpdate({ update_id: 9, callback_query: { id: "cs", from: mk(1, "A"), data: "s", message: { chat: { id: C, type: "group" }, message_id: 1 } } });
  assert.equal(g.phase, "night");
  // все молчат: форсим дедлайн ночи
  g.phaseData.deadline = Date.now() - 10; await bot.tick();
  assert.equal(g.phase, "day", "ночь прошла по таймеру");
  // день молчим
  g.phaseData.deadline = Date.now() - 10; await bot.tick();
  assert.equal(g.phase, "vote", "день прошёл по таймеру");
  // голосование молчим
  g.phaseData.deadline = Date.now() - 10; await bot.tick();
  assert.ok(["night", "ended", "day"].includes(g.phase), "голосование разрешилось по таймеру (день 2): " + g.phase);
  assert.equal(g.dayNo, 2, "наступила ночь 2 (мафия никого не убила — pas)");
  console.log("✅ Таймеры работают: игра идёт, даже если все молчат");
})().catch(e => { console.error("❌", e.message); process.exit(1); });
