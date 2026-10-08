/* Умная подписка: одно предупреждение, авто-добавление после подписки; новая мафия заблокирована до конца игр */
process.env.MAFIA_MEMORY = "1"; process.env.MAFIA_CHANNEL = "@testkanal";
const assert = require("assert");
const bot = require("./bot.js");
const SUB = bot.SUB_STUB || new Set();
let mid = 1; const OUT = [];
global.fetch = async (url, opts) => {
  let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
  if (url.includes("getChatMember")) return { ok: true, status: 200, json: async () => ({ ok: true, result: { status: "member" } }) };
  OUT.push({ method: url.split("/").pop(), body });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: ++mid, chat: { id: body.chat_id } } }) };
};
const C1 = -7001, C2 = -7002, mk = (i, n) => ({ id: 3000 + i, first_name: n || "P" + i });
const msg = (from, text, chat) => ({ update_id: ++mid, message: { chat: { id: chat, type: "group" }, from, text } });
const cb = (from, data, inChat) => ({ update_id: ++mid, callback_query: { id: "q" + (++mid), from, data, message: { chat: { id: inChat, type: "group" }, message_id: 1 } } });
const sent = () => OUT.filter(o => o.method === "sendMessage").map(o => o.body).filter(Boolean);
const pops = () => OUT.filter(o => o.method === "answerCallbackQuery").map(o => o.body).filter(b => b && b.text).map(b => b.text);
let pass = 0; const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log("  ✅ " + name); };

(async () => {
  console.log("— Подписка обязательна —");
  SUB.add(3002); // P2 не подписан
  await bot.handleUpdate(msg(mk(1, "Creator"), "/start", C1));
  const g = bot.MEM.get(C1);
  ok("создатель (подписан) сразу в лобби", g.players.length === 1);
  // не подписанный жмёт «вступить»
  await bot.handleUpdate(cb(mk(2, "P2"), "j", C1));
  ok("не подписанный НЕ вступил", g.players.length === 1);
  const warns = sent().filter(s => /obuna boʻling/i.test(s.text || ""));
  ok("одно сообщение с предупреждением отправлено", warns.length === 1);
  const wkb = JSON.stringify(warns[0].reply_markup || {});
  ok("в предупреждении: кнопка канала + «✅ Tekshirish» V:", wkb.includes("t.me/") && wkb.includes(`"V:${C1}:3002"`));
  // повторное нажатие — НЕ дублирует сообщение
  await bot.handleUpdate(cb(mk(2, "P2"), "j", C1));
  ok("второй раз — без нового сообщения (одно на игрока)", sent().filter(s => /obuna boʻling/i.test(s.text || "")).length === 1);
  // проверка подписки: ещё не подписан
  await bot.handleUpdate(cb(mk(2, "P2"), `V:${C1}:3002`, C1));
  ok("проверка: подписки нет — игрок не добавлен", g.players.length === 1 && /topilmadi/.test(pops().slice(-1)[0] || ""));
  // подписался (убираем заглушку) и жмёт «проверить»
  SUB.delete(3002);
  await bot.handleUpdate(cb(mk(2, "P2"), `V:${C1}:3002`, C1));
  ok("после подписки игрок автоматически вступил", g.players.length === 2 && !!g.players.find(p => p.id === 3002));
  // чужой не может проверять за другого
  SUB.add(3003);
  await bot.handleUpdate(cb(mk(3, "P3"), `V:${C1}:3002`, C1));
  ok("чужой не может проверить за другого (не добавился)", g.players.length === 2);

  console.log("— Одна мафия за раз —");
  for (let i = 3; i <= 5; i++) { SUB.delete(3000 + i); await bot.handleUpdate(cb(mk(i), "j", C1)); }
  ok("теперь 5 игроков", g.players.length === 5);
  // создатель игры №1 пытается открыть вторую мафию в ДРУГОЙ группе
  await bot.handleUpdate(msg(mk(1, "Creator"), "/start", C2));
  ok("игрок в активной игре не может открыть новую в другой группе", !bot.MEM.get(C2));
  ok("пришло умное предупреждение", sent().filter(s => /boshqa guruhda oʻyindasiz/i.test(s.text || "")).length === 1);
  // старт игры №1
  const g2b = bot.MEM.get(C1); g2b.admListCache = { list: [mk(1).id], ts: Date.now() };
  await bot.startGame(g2b);
  ok("игра пошла (ночь 1)", g2b.phase === "night");
  // /start в той же группе во время игры
  await bot.handleUpdate(msg(mk(5), "/start", C1));
  ok("в группе с активной игрой новая не открывается", bot.MEM.get(C1).phase === "night");
  // админ завершает — теперь можно открывать новую
  g2b.phase = "ended"; bot.MEM.delete(C1);
  await bot.handleUpdate(msg(mk(1, "Creator"), "/start", C1));
  ok("после завершения игры новая мафия открывается", bot.MEM.get(C1) && bot.MEM.get(C1).phase === "lobby");

  console.log(`\n🎯 ИТОГ: ${pass} проверок — подписка и умные блокировки работают`);
})().catch(e => { console.error("❌ ПРОВАЛ:", e.message); process.exit(1); });
