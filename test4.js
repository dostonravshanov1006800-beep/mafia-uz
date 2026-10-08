/* Система как у TrueMafia: профили, XP, рейтинг, монеты, ачивки, топ, бонус */
process.env.MAFIA_MEMORY = "1";
const assert = require("assert");
const bot = require("./bot.js");
let SENT = [], mid = 1;
global.fetch = async (url, opts) => {
  let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
  SENT.push(body);
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: ++mid, chat: { id: body.chat_id } } }) };
};
const C = -2000, mk = (i) => ({ id: 5000 + i, first_name: "Player" + i });
(async () => {
  // полная партия: 4 игрока, мафия убивает, город казнит дона
  await bot.handleUpdate({ update_id: 1, message: { chat: { id: C, type: "group" }, from: mk(1), text: "/start" } });
  for (let i = 2; i <= 4; i++) await bot.handleUpdate({ update_id: i, callback_query: { id: "c" + i, from: mk(i), data: "j", message: { chat: { id: C, type: "group" }, message_id: 1 } } });
  await bot.handleUpdate({ update_id: 9, callback_query: { id: "cs", from: mk(1), data: "s", message: { chat: { id: C, type: "group" }, message_id: 1 } } });
  const g = bot.MEM.get(C);
  assert.equal(g.phase, "night");
  const don = g.players.find(p => p.role === "don"), doc = g.players.find(p => p.role === "doctor"), sher = g.players.find(p => p.role === "sheriff");
  const civ = g.players.find(p => p.role === "civ");
  // доктор НЕ спасает жертву → комиссар угадывает дона
  await bot.handleUpdate({ update_id: 10, callback_query: { id: "n1", from: don, data: `A:${C}:n${civ.num}`, message: { chat: { id: C, type: "group" }, message_id: 1 } } });
  await bot.handleUpdate({ update_id: 11, callback_query: { id: "n2", from: doc, data: `A:${C}:n${doc.num}`, message: { chat: { id: C, type: "group" }, message_id: 1 } } });
  await bot.handleUpdate({ update_id: 12, callback_query: { id: "n3", from: sher, data: `A:${C}:n${don.num}`, message: { chat: { id: C, type: "group" }, message_id: 1 } } });
  assert.equal(g.phase, "day");
  g.phaseData.deadline = Date.now() - 10; await bot.tick(); // голосование
  assert.equal(g.phase, "vote");
  for (const v of g.players.filter(p => p.alive)) {
    const target = v.id === don.id ? sher.num : don.num;
    await bot.handleUpdate({ update_id: 20 + v.num, callback_query: { id: "v" + v.num, from: v, data: `A:${C}:v${target}`, message: { chat: { id: C, type: "group" }, message_id: 1 } } });
  }
  assert.equal(g.phase, "ended", "игра завершена");

  // --- проверки системы ---
  for (const p of g.players) {
    const prof = bot.PROFILES.get(p.id);
    assert.ok(prof, "профиль создан для " + p.id);
    assert.equal(prof.games, 1, "игра записана");
    const won = p.role !== "don";
    assert.equal(prof.wins, won ? 1 : 0, "победы");
    assert.equal(prof.xp, won ? 35 : 12, "XP");
    assert.equal(prof.coins, won ? 20 : 5, "монеты");
    assert.ok(prof.rating !== 1000, "рейтинг изменился");
    assert.ok(prof.ach.includes("first"), "ачивка первая игра");
  }
  const sherProf = bot.PROFILES.get(sher.id);
  assert.equal(sherProf.checks, 1, "комиссару записана точная проверка");
  const winnerAch = sherProf.ach.includes("firstWin");
  assert.ok(winnerAch, "ачивка первая победа");

  // ЛС каждому с итогами
  const summaryPms = SENT.filter(s => /Gʻalaba|Magʻlubiyat/.test(s.text || "") && !s.chat_id.toString().startsWith("-"));
  assert.equal(summaryPms.length, 4, "итоговые ЛС всем игрокам");

  // топ
  assert.equal(bot.TOP.length, 4, "топ заполнен");
  const topText = bot.topText("uz");
  assert.ok(topText.includes("Player"), "топ показывает игроков");

  // бонус: один раз в день
  const prof = await bot.getProfile(don.id, "Player1");
  const b1 = bot.claimBonus(prof);
  assert.ok(b1.ok && b1.amount === 10, "первый бонус 10 монет");
  assert.equal(prof.coins, 5 + 10, "монеты за бонус");
  const b2 = bot.claimBonus(prof);
  assert.ok(!b2.ok, "повторный бонус в тот же день не даётся");

  // карточка профиля
  const card = bot.cardOf(prof, "uz");
  assert.ok(card.includes("Reyting") && card.includes("Tanga") && card.includes("Yutuqlar"), "карточка полная");
  assert.ok(bot.levelOf(0) === 1 && bot.levelOf(4000) > 8, "уровни растут от XP");

  console.log("✅ Система как у топ-ботов: профили, XP, уровни, рейтинг, монеты, ачивки, топ, бонус — всё работает");
})().catch(e => { console.error("❌", e.message); process.exit(1); });
