/* СТРОГИЕ права: панель и управление только у настоящих админов группы Telegram */
process.env.MAFIA_MEMORY = "1";
globalThis.__STRICT_ADMIN = true;
const assert = require("assert");
const bot = require("./bot.js");
let mid = 1; const OUT = [];
const ADMINS = new Set([7001]); // настоящий админ группы
global.fetch = async (url, opts) => {
  let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
  const m = url.split("/").pop();
  if (m === "getChatMember") {
    const st = ADMINS.has(body.user_id) ? "administrator" : "member";
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { status: st, user: { id: body.user_id } } }) };
  }
  if (m === "getChatAdministrators") {
    return { ok: true, status: 200, json: async () => ({ ok: true, result: [...ADMINS].map(id => ({ status: "administrator", user: { id, is_bot: false } })) }) };
  }
  OUT.push({ method: m, body });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: ++mid, chat: { id: body.chat_id } } }) };
};
const C = -8800, adm = { id: 7001, first_name: "Admin" };
const mk = i => ({ id: 7100 + i, first_name: "Player" + i });
const msg = (from, text, chat) => ({ update_id: ++mid, message: { chat: { id: chat, type: "group" }, from, text } });
const cb = (from, data, chat) => ({ update_id: ++mid, callback_query: { id: "q" + (++mid), from, data, message: { chat: { id: chat, type: "group" }, message_id: 1 } } });
const toUser = id => OUT.filter(o => o.body && o.body.chat_id === id);
const pops = () => OUT.filter(o => o.method === "answerCallbackQuery").map(o => o.body.text).filter(Boolean);
let pass = 0; const ok = (n, c) => { assert.ok(c, n); pass++; console.log("  ✅ " + n); };

(async () => {
  console.log("— Обычный игрок открыл лобби —");
  const p1 = mk(1);
  await bot.handleUpdate(msg(p1, "/start", C));
  const g = bot.MEM.get(C);
  ok("лобби создано, обычный игрок вступил как игрок", g && g.players.length === 1);
  ok("обычному игроку НЕ пришла панель управления", toUser(p1.id).filter(o => /boshqaruv|управлен/i.test(o.body.text || "")).length === 0);
  ok("настоящему админу группы панель пришла", toUser(adm.id).some(o => /boshqaruv/i.test(o.body.text || "")));
  for (let i = 2; i <= 5; i++) await bot.handleUpdate(cb(mk(i), "j", C));
  ok("5 игроков в лобби", g.players.length === 5);

  console.log("— Обычные игроки не управляют —");
  await bot.handleUpdate(cb(p1, "s", C));
  ok("создатель-не-админ НЕ может стартовать игру", g.phase === "lobby");
  await bot.handleUpdate(cb(mk(2), `S:${C}`, 0)); 
  ok("чужая панель-кнопка S: от обычного игрока не стартует", g.phase === "lobby");
  await bot.handleUpdate(cb(p1, "x", C));
  ok("создатель-не-админ НЕ может отменить", bot.MEM.get(C) && bot.MEM.get(C).phase === "lobby");
  await bot.handleUpdate(cb(p1, "k:2", C));
  ok("не может кикнуть", g.players.length === 5);
  await bot.handleUpdate(msg(p1, "/skip", C));
  await bot.handleUpdate(msg(p1, "/end", C));
  ok("/end и /skip от обычного игрока не работают", bot.MEM.get(C) && bot.MEM.get(C).phase === "lobby");
  ok("получил попап «только админы»", pops().length > 0);

  console.log("— Настоящий админ управляет —");
  await bot.handleUpdate(cb(adm, "s", C));
  ok("админ группы стартует игру", g.phase === "night");
  console.log("— Роли только в личку —");
  const groupTexts = OUT.filter(o => o.method === "sendMessage" && o.body.chat_id === C).map(o => o.body.text || "").join(" ");
  ok("в общий чат роли игроков не утекли", !/Rolingiz|Ваша роль/.test(groupTexts));
  ok("каждый игрок получил роль в личку", g.players.every(p => toUser(p.id).some(o => /Rolingiz|Ваша роль|Роль|rol/i.test(o.body.text || ""))));

  console.log(`\n🎯 ИТОГ: ${pass} проверок — права строго по админам Telegram`);
})().catch(e => { console.error("❌ ПРОВАЛ:", e.message); process.exit(1); });
