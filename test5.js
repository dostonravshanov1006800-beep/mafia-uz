/* Права: обычные — только вступить/выйти; админы группы — старт/отмена/язык/кик/skip/end */
process.env.MAFIA_MEMORY = "1";
const assert = require("assert");
const bot = require("./bot.js");
let mid = 1;
const ADMINS = new Set([9001]); // этот id — админ группы
global.fetch = async (url, opts) => {
  let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
  if (url.includes("getChatMember")) {
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { status: ADMINS.has(body.user_id) ? "administrator" : "member" } }) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: ++mid, chat: { id: body.chat_id } } }) };
};
const C = -3000, mk = (i) => ({ id: 100 + i, first_name: "Player" + i });
const upd = {
  msg: (from, text) => ({ update_id: mid + 500, message: { chat: { id: C, type: "group" }, from, text } }),
  cb: (from, data) => ({ update_id: mid + 600, callback_query: { id: "q" + (++mid), from, data, message: { chat: { id: C, type: "group" }, message_id: 1 } } }),
};
(async () => {
  // лобби создал НЕ-админ (1001)
  await bot.handleUpdate(upd.msg(mk(1), "/start"));
  for (let i = 2; i <= 4; i++) await bot.handleUpdate(upd.cb(mk(i), "j"));
  const g = bot.MEM.get(C);
  assert.equal(g.players.length, 4);

  // обычный игрок жмёт старт → отказ
  await bot.handleUpdate(upd.cb(mk(2), "s"));
  assert.equal(g.phase, "lobby", "не-админ не смог стартовать");

  // а вот АДМИН группы (9001, не создавал лобби!) жмёт старт → игра пошла
  await bot.handleUpdate({ update_id: 900001, callback_query: { id: "qadm", from: { id: 9001, first_name: "Admin" }, data: "s", message: { chat: { id: C, type: "group" }, message_id: 1 } } });
  assert.equal(g.phase, "night", "админ группы стартовал игру");

  // обычный /skip → отказ, фаза та же
  await bot.handleUpdate(upd.msg(mk(2), "/skip"));
  assert.equal(g.phase, "night");

  // админ /skip → ночь пропущена → день
  await bot.handleUpdate({ update_id: 900002, message: { chat: { id: C, type: "group" }, from: { id: 9001, first_name: "Admin" }, text: "/skip" } });
  assert.equal(g.phase, "day", "админ пропустил ночь");

  // обычный /end → отказ; админ /end → игра отменена
  await bot.handleUpdate(upd.msg(mk(3), "/end"));
  assert.equal(g.phase, "day", "не-админ не отменил");
  await bot.handleUpdate({ update_id: 900003, message: { chat: { id: C, type: "group" }, from: { id: 9001, first_name: "Admin" }, text: "/end" } });
  assert.equal(g.phase, "ended", "админ отменил игру");

  // кик в лобби: новый лобби, админ кикнет игрока №2
  await bot.handleUpdate(upd.msg(mk(1), "/start"));
  const g2 = bot.MEM.get(C);
  for (let i = 2; i <= 4; i++) await bot.handleUpdate(upd.cb(mk(i), "j"));
  assert.equal(g2.players.length, 4); // создатель + 3 присоединившихся
  await bot.handleUpdate({ update_id: 900004, callback_query: { id: "qk", from: { id: 9001, first_name: "Admin" }, data: "k:2", message: { chat: { id: C, type: "group" }, message_id: 1 } } });
  assert.equal(g2.players.length, 3, "админ выкинул игрока");
  // обычный пробует кик → отказ
  await bot.handleUpdate(upd.cb(mk(3), "k:1"));
  assert.equal(g2.players.length, 3, "не-админ не выкинул");
  // номера перенумерованы
  assert.deepEqual(g2.players.map(p => p.num), [1, 2, 3]);

  console.log("✅ Права работают: обычные — только вступить/выйти; админы — старт, отмена, кик, skip, /end, язык");
})().catch(e => { console.error("❌", e.message); process.exit(1); });
