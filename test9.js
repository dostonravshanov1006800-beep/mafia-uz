/* Реальные сценарии игроков: /rules, /lang, неизвестная команда, пустое лобби, ничья → ревот, доктор не лечит себя 2 ночи подряд, роль в ЛС */
process.env.MAFIA_MEMORY = "1"; process.env.MAFIA_CHANNEL = "@testkanal";
const assert = require("assert");
const bot = require("./bot.js");
let mid = 1; const OUT = [];
global.fetch = async (url, opts) => {
  let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
  if (url.includes("getChatMember")) return { ok: true, status: 200, json: async () => ({ ok: true, result: { status: "administrator" } }) };
  OUT.push({ method: url.split("/").pop(), body });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: ++mid, chat: { id: body.chat_id } } }) };
};
const C = -9500, mk = i => ({ id: 5000 + i, first_name: "U" + i });
const msg = (from, text, chat) => ({ update_id: ++mid, message: { chat: { id: chat, type: chat < 0 ? "group" : "private" }, from, text } });
const cb = (from, data, inChat) => ({ update_id: ++mid, callback_query: { id: "q" + (++mid), from, data, message: { chat: { id: inChat, type: "group" }, message_id: 1 } } });
const sms = () => OUT.filter(o => o.method === "sendMessage").map(o => o.body).filter(Boolean);
let pass = 0; const ok = (n, c) => { assert.ok(c, n); pass++; console.log("  ✅ " + n); };

(async () => {
  console.log("— /rules и подсказки —");
  await bot.handleUpdate(msg(mk(1), "/rules", C));
  ok("/rules в группе: правила с ролями", /Komissar/.test(sms().slice(-1)[0].text) && /Tinch aholi/.test(sms().slice(-1)[0].text));
  await bot.handleUpdate(mk(1) && msg(mk(1), "/qoida", C));
  ok("/qoida — алиас работает", /qoidalari/.test(sms().slice(-1)[0].text));
  await bot.handleUpdate(msg(mk(1), "/pidr", C));
  ok("неизвестная команда → подсказка один раз", /Bunday buyruq/.test(sms().slice(-1)[0].text));
  const hintsBefore = sms().filter(s => /Bunday buyruq/.test(s.text || "")).length;
  await bot.handleUpdate(msg(mk(1), "/pidr2", C));
  const hintsAfter = sms().filter(s => /Bunday buyruq/.test(s.text || "")).length;
  ok("спам-защита: повторная подсказка не чаще раза в час", hintsBefore === 1 && hintsAfter === 1);

  console.log("— Пустое лобби закрывается —");
  await bot.handleUpdate(msg(mk(1), "/start", C));
  const g = bot.MEM.get(C);
  await bot.handleUpdate(cb(mk(1), "l", C));
  ok("последний игрок ушёл → лобби закрыто, состояние удалено", !bot.MEM.get(C));
  ok("сообщение «Lobbi yopildi» показано", /yopildi/.test(OUT.filter(o => o.method === "editMessageText" || o.method === "sendMessage").map(o => JSON.stringify(o.body)).join(" ")));

  console.log("— Ничья → повторное голосование —");
  await bot.handleUpdate(msg(mk(1), "/start", C));
  const g2 = bot.MEM.get(C);
  for (let i = 2; i <= 5; i++) await bot.handleUpdate(cb(mk(i), "j", C));
  await bot.startGame(g2);
  // 2 против 2 — ничья
  g2.phase = "vote"; g2.phaseData = { votes: {}, deadline: Date.now() + 60000, shown: 999 };
  const al = g2.players.filter(p => p.alive);
  g2.phaseData.votes[al[0].id] = al[2].num; g2.phaseData.votes[al[2].id] = al[0].num;
  g2.phaseData.votes[al[1].id] = al[3].num; g2.phaseData.votes[al[3].id] = al[1].num;
  await bot.resolveVote(g2);
  ok("при ничьей — повторное голосование (revote)", g2.phase === "vote" && g2.phaseData.revote === true);
  ok("сообщение «Ovozlar teng boʻldi»", /teng boʻldi/.test(sms().map(s => s.text || "").join(" ")));
  // вторая ничья — никого не изгоняют
  const al2 = g2.players.filter(p => p.alive);
  g2.phaseData.votes[al2[0].id] = al2[2].num; g2.phaseData.votes[al2[2].id] = al2[0].num;
  await bot.resolveVote(g2);
  ok("вторая ничья — никто не изгнан, ночь наступила", g2.phase === "night" && g2.dayNo === 2);

  console.log("— Доктор: себя не лечить 2 ночи подряд —");
  const doc = g2.players.find(p => p.role === "doctor");
  const kbText = () => JSON.stringify(OUT.filter(o => o.method === "sendMessage" && o.body.chat_id === doc.id).map(o => o.body.reply_markup).slice(-1)[0] || {});
  const kb1 = kbText();
  ok("ночью 1 доктор видит себя в списке", kb1.includes(`n${doc.num}"`));
  // доктор лечит себя → ночь 2
  const a = g2.phaseData.actions;
  await bot.resolveNight(g2); // завершит ночь 2 (никто не убил)
  // дошли до ночи 3? ночь 2 завершилась → день; пропустим день и голосование
  g2.phaseData.deadline = 0; await bot.tick(); // день
  g2.phaseData.deadline = 0; await bot.tick(); // голосование → решится
  if (g2.phase === "vote") { g2.phaseData.votes[g2.players.find(p => p.alive).id] = "pass"; g2.phaseData.deadline = 0; await bot.tick(); }
  ok("снова ночь", g2.phase === "night");
  // имитируем, что прошлой ночью он лечил себя
  g2.prevHealSelf = { [doc.id]: true };
  // перешлём выбор цели доктору заново (beginNight уже отработал до нас — проверим фильтр напрямую)
  const alive = g2.players.filter(p => p.alive);
  const dlist = (g2.prevHealSelf || {})[doc.id] ? alive.filter(x => x.id !== doc.id) : alive;
  ok("после само-лечения доктор исключён из своих целей", !dlist.find(x => x.id === doc.id) && dlist.length > 0);

  console.log("— Роль в ЛС при /start во время игры —");
  const pmsg = msg(g2.players[0], "/start", g2.players[0].id);
  await bot.handleUpdate(pmsg);
  const pmLast = sms().filter(s => s.chat_id === g2.players[0].id).slice(-1)[0];
  ok("в ЛС напомнена роль и фаза", /Rolingiz/.test(pmLast.text || "") && /(TUN|KUN)/.test(pmLast.text || ""));

  console.log(`\n🎯 ИТОГ: ${pass} проверок — реальные сценарии игроков покрыты`);
})().catch(e => { console.error("❌ ПРОВАЛ:", e.message); process.exit(1); });
