/* Headless-тест движка: полная игра 5 игроков без Telegram */
process.env.MAFIA_MEMORY = "1";
const assert = require("assert");
const bot = require("./bot.js");

const SENT = [];
const CHAT = -100777;
let msgId = 1;

// мокаем fetch: api.telegram.org → записи, прочее → 404
global.fetch = async (url, opts) => {
  if (!url.includes("api.telegram.org")) return { ok: false, status: 404, json: async () => ({}) };
  const m = url.match(/\/(sendMessage|editMessageText|answerCallbackQuery)/);
  const method = m ? m[1] : "other";
  let body = {};
  try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
  SENT.push({ method, body });
  if (method === "sendMessage") body.__mid = ++msgId;
  return {
    ok: true, status: 200,
    json: async () => ({
      ok: true,
      result: method === "sendMessage" ? { message_id: msgId, chat: { id: body.chat_id } } : true,
    }),
  };
};

const users = [111, 222, 333, 444, 555].map((id, i) => ({
  id, first_name: "Player" + (i + 1), username: "u" + id,
}));
const upd = {
  msg: (from, text, chat = CHAT) => ({ update_id: SENT.length + 1, message: { chat: { id: chat, type: chat < 0 ? "group" : "private" }, from, text } }),
  cb: (from, data, chat = CHAT) => ({ update_id: SENT.length + 1, callback_query: { id: "cb" + (SENT.length + 1), from, data, message: { chat: { id: chat, type: "group" }, message_id: 1 } } }),
};
const inChat = (o) => SENT.filter(s => s.body.chat_id === CHAT);
const pmsTo = (id) => SENT.filter(s => s.body.chat_id === id && s.method === "sendMessage");

(async () => {
  // 1) /start в группе → лобби
  await bot.handleUpdate(upd.msg(users[0], "/start"));
  assert.ok(bot.MEM.get(CHAT), "игра создана");

  // 2) присоединяются 4 игрока
  for (const u of users.slice(1, 5)) await bot.handleUpdate(upd.cb(u, "j"));
  const g = bot.MEM.get(CHAT);
  assert.equal(g.players.length, 5, "5 игроков в лобби");

  // 3) не-создатель не может стартовать
  SENT.length = 0;
  await bot.handleUpdate(upd.cb(users[1], "s"));
  assert.equal(g.phase, "lobby", "не-создатель не стартовал");

  // 4) старт
  await bot.handleUpdate(upd.cb(users[0], "s"));
  assert.equal(g.phase, "night", "ночь началась");
  assert.equal(g.dayNo, 1);
  // роли распределены: 1 дон, 1 комиссар, 1 доктор (5 игроков → mafiaCount=1)
  const roles = g.players.map(p => p.role).sort();
  assert.deepEqual(roles, ["civ", "civ", "doctor", "don", "sheriff"].sort(), "роли верные");
  // каждому игроку отправлена роль в личку
  for (const p of g.players) {
    const pm = pmsTo(p.id);
    assert.ok(pm.length >= 1, "роль отправлена " + p.id);
    assert.ok(pm.some(x => / rol[: ]|роль/i.test(x.body.text)), "текст роли");
  }

  const don = g.players.find(p => p.role === "don");
  const doc = g.players.find(p => p.role === "doctor");
  const sher = g.players.find(p => p.role === "sheriff");

  // 5) ночные действия: дон убивает доктора, доктор лечит себя, комиссар проверяет дона
  await bot.handleUpdate(upd.cb(don, `A:${CHAT}:n${doc.num}`));
  await bot.handleUpdate(upd.cb(doc, `A:${CHAT}:n${doc.num}`));
  await bot.handleUpdate(upd.cb(sher, `A:${CHAT}:n${don.num}`));
  assert.equal(g.phase, "day", "ночь разрешилась, день настал");
  // комиссар получил проверку
  const sherPm = pmsTo(sher.id).pop();
  assert.ok(sherPm.body.text.includes("МАФИЯ") || sherPm.body.text.includes("MAFIYA"), "комиссар узнал мафию");
  // доктор спасён — никто не умер
  const aliveCount = g.players.filter(p => p.alive).length;
  assert.equal(aliveCount, 5, "доктор спас себя — все живы");

  // 6) день → форсим таймер → голосование
  g.phaseData.deadline = Date.now() - 10;
  await bot.tick();
  assert.equal(g.phase, "vote", "голосование началось");

  // 7) все голосуют за дона (num)
  const voters = g.players.filter(p => p.alive);
  for (const v of voters) {
    const target = v.id === don.id ? sher.num : don.num; // дон голосует за комиссара, остальные за дона
    await bot.handleUpdate(upd.cb(v, `A:${CHAT}:v${target}`));
  }
  assert.equal(g.phase, "ended", "игра завершена");
  assert.equal(g.players.find(p => p.id === don.id).alive, false, "дон казнён");
  const endMsg = inChat().map(s => s.body.text).join("\n");
  assert.ok(endMsg.includes("Мирные") || endMsg.includes("TINCH"), "мирные победили");

  // 8) «играть снова» — новое лобби
  await bot.handleUpdate(upd.cb(users[2], "r"));
  assert.equal(bot.MEM.get(CHAT).phase, "lobby", "новое лобби после игры");

  console.log("✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ — полная партия: лобби → роли → ночь → день → голос → победа → реванш");
})().catch(e => { console.error("❌ ТЕСТ ПАЛ:", e.message); process.exit(1); });
