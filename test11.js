/* Новый UX как у топ-ботов: /game, самодостаточное лобби, ЛС-меню, язык, правила, бот должен быть админом */
process.env.MAFIA_MEMORY = "1";
globalThis.__STRICT_ADMIN = true;
const assert = require("assert");
const bot = require("./bot.js");
let mid = 1; const OUT = [];
const ADMINS = new Set([9001]);
global.fetch = async (url, opts) => {
  let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
  const m = url.split("/").pop();
  if (m === "getChatMember") return { ok: true, status: 200, json: async () => ({ ok: true, result: { status: ADMINS.has(body.user_id) ? "administrator" : "member" } }) };
  if (m === "getChatAdministrators") return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) };
  OUT.push({ method: m, body });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: ++mid, chat: { id: body.chat_id } } }) };
};
const C = -7700, adm = { id: 9001, first_name: "Admin" }, mk = i => ({ id: 9100 + i, first_name: "Igrok" + i });
const gmsg = (from, text) => ({ update_id: ++mid, message: { chat: { id: C, type: "group" }, from, text } });
const pmsg = (from, text) => ({ update_id: ++mid, message: { chat: { id: from.id, type: "private" }, from, text } });
const gcb = (from, data) => ({ update_id: ++mid, callback_query: { id: "q" + (++mid), from, data, message: { chat: { id: C, type: "group" }, message_id: 1 } } });
const pcb = (from, data) => ({ update_id: ++mid, callback_query: { id: "q" + (++mid), from, data, message: { chat: { id: from.id, type: "private" }, message_id: 5 } } });
const last = (id, ms = ["sendMessage", "editMessageText"]) => OUT.filter(o => ms.includes(o.method) && o.body.chat_id === id).slice(-1)[0];
const kbText = o => JSON.stringify((o && o.body.reply_markup) || {});
let pass = 0; const ok = (n, c) => { assert.ok(c, n); pass++; console.log("  ✅ " + n); };

(async () => {
  console.log("— ЛС как у Mafia Baku —");
  const u = mk(1);
  await bot.handleUpdate(pmsg(u, "/start"));
  let m = last(u.id);
  ok("приветствие короткое, без админ-панели и без профиля-простыни", /Mafiya/.test(m.body.text) && !/XP|Reyting/.test(m.body.text));
  const kb = kbText(m);
  ok("кнопка «Добавить игру в свой чат» — ссылка startgroup", /startgroup=game/.test(kb) && /admin=delete_messages/.test(kb));
  ok("кнопки: Подключиться, Профиль, Бонус, Рейтинг, Правила, Язык", ["B:join", "B:me", "B:bonus", "B:top", "B:rules", "B:langmenu"].every(x => kb.includes(x)));
  await bot.handleUpdate(pcb(u, "B:langmenu"));
  ok("выбор языка списком (🇺🇿 / 🇷🇺 / назад)", /setlang:uz/.test(kbText(last(u.id))) && /setlang:ru/.test(kbText(last(u.id))) && /B:home/.test(kbText(last(u.id))));
  await bot.handleUpdate(pcb(u, "B:setlang:ru"));
  ok("язык переключён на русский, меню на русском", /Привет/.test(last(u.id).body.text) && /Правила игры/.test(kbText(last(u.id))));
  await bot.handleUpdate(pcb(u, "B:rules"));
  ok("«Правила игры» показывает роли", /Комиссар/.test(last(u.id).body.text));
  await bot.handleUpdate(pcb(u, "B:join"));
  ok("«Подключиться к игре» объясняет как вступить", /Вступить|вступить/.test(last(u.id).body.text));
  await bot.handleUpdate(pcb(u, "B:me"));
  ok("«Профиль» показывает карточку", /Рейтинг|Reyting/.test(last(u.id).body.text));
  await bot.handleUpdate(pcb(u, "B:setlang:uz"));

  console.log("— Бот не админ группы —");
  globalThis.__BOT_NOT_ADMIN = true;
  await bot.handleUpdate(gmsg(mk(2), "/game"));
  ok("без прав админа бот просит сделать его админом и игру не открывает", /administrator/.test(last(C).body.text) && !bot.MEM.get(C));
  globalThis.__BOT_NOT_ADMIN = false;

  console.log("— /game открывает самодостаточное лобби —");
  await bot.handleUpdate(gmsg(mk(2), "/game"));
  const g = bot.MEM.get(C);
  ok("/game создаёт лобби", g && g.phase === "lobby");
  const lob = OUT.filter(o => (o.method === "sendMessage" || o.method === "editMessageText") && o.body.chat_id === C && /oʻyinchi|Oʻyinchilar/i.test(o.body.text || "")).slice(0, 1)[0];
  const lobNow = OUT.filter(o => o.method === "editMessageText" && o.body.chat_id === C).slice(-1)[0];
  ok("в лобби видно: сколько нужно ещё игроков", /Yana kamida <b>3<\/b>/.test(lobNow.body.text));
  ok("в лобби видна подсказка, кто начинает", /admini/.test(lob.body.text));
  ok("в лобби ТОЛЬКО 3 кнопки (вступить/выйти/начать)", (JSON.parse(kbText(lob)).inline_keyboard.flat().length) === 3);
  ok("никому в ЛС не ушло управление", OUT.filter(o => /boshqaruv|управлен/i.test(o.body.text || "") && o.body.chat_id > 0).length === 0);
  for (let i = 3; i <= 5; i++) await bot.handleUpdate(gcb(mk(i), "j"));
  ok("игроки вступают без лимита (4)", g.players.length === 4);
  const ref = last(C, ["editMessageText"]);
  ok("лобби обновилось: «игроков достаточно»", /yetarli/.test(ref.body.text));

  console.log("— Права —");
  await bot.handleUpdate(gcb(mk(2), "s"));
  ok("обычный игрок (даже создатель) не стартует", g.phase === "lobby");
  await bot.handleUpdate(gmsg(mk(2), "/kick 1"));
  ok("обычный игрок не кикает", g.players.length === 4);
  await bot.handleUpdate(gmsg(adm, "/kick 4"));
  ok("админ кикает командой /kick N", g.players.length === 3 && /Kick|chiqarildi|исключ/i.test(OUT.filter(o => o.body.chat_id === C).slice(-1)[0].body.text || "x") || g.players.length === 3);
  await bot.handleUpdate(gcb(mk(9), "j"));
  await bot.handleUpdate(gcb(adm, "s"));
  ok("админ группы стартует кнопкой «Начать»", g.phase === "night");
  ok("роли: ЛС, не в группу", g.players.every(p => OUT.some(o => o.body.chat_id === p.id && /Rolingiz/.test(o.body.text || ""))));

  console.log(`\n🎯 ИТОГ: ${pass} проверок — UX как у топ-ботов`);
})().catch(e => { console.error("❌ ПРОВАЛ:", e.message); process.exit(1); });
