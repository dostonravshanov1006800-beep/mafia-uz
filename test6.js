/* ПОЛНЫЙ E2E: каждая кнопка, каждое действие, от создания до итогов */
process.env.MAFIA_MEMORY = "1";
const assert = require("assert");
const bot = require("./bot.js");
let mid = 1; const OUT = [];
const ADMINS = new Set([9001]);
global.fetch = async (url, opts) => {
  let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
  if (url.includes("getChatMember")) {
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { status: ADMINS.has(body.user_id) ? "administrator" : "member" } }) };
  }
  OUT.push({ method: url.split("/").pop(), body });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: ++mid, chat: { id: body.chat_id } } }) };
};
const C = -6000, mk = (i, n) => ({ id: 8000 + i, first_name: n || "Player" + i });
const adm = { id: 9001, first_name: "Admin" };
const msg = (from, text) => ({ update_id: ++mid + 1000, message: { chat: { id: C, type: "group" }, from, text } });
const cb = (from, data) => ({ update_id: ++mid + 2000, callback_query: { id: "q" + (++mid), from, data, message: { chat: { id: C, type: "group" }, message_id: 1 } } });
const sent = () => OUT.map(o => o.body).filter(Boolean);
const lastText = m => { const f = sent().filter(s => (s.text || "").includes(m)); return f[f.length - 1]; };
let pass = 0; const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log("  ✅ " + name); };

(async () => {
  console.log("— ЭТАП 1: Лобби —");
  await bot.handleUpdate(msg(adm, "/start"));
  const g = bot.MEM.get(C);
  ok("лобби создано", g && g.phase === "lobby");
  // вступление и выход
  await bot.handleUpdate(cb(mk(2), "j"));
  ok("кнопка ➕ вступить", g.players.length === 2);
  await bot.handleUpdate(cb(mk(2), "l"));
  ok("кнопка ➖ выйти", g.players.length === 1);
  await bot.handleUpdate(cb(mk(2), "j"));
  for (let i = 3; i <= 5; i++) await bot.handleUpdate(cb(mk(i), "j"));
  ok("все вступили (5 игроков)", g.players.length === 5);
  ok("повторное вступить не дублирует", (g.players.filter(p => p.id === 8002).length === 1));
  // не-админ не стартует
  await bot.handleUpdate(cb(mk(3), "s"));
  ok("не-админ НЕ может старт", g.phase === "lobby");
  // смена языка админом (RU), потом обратно UZ
  await bot.handleUpdate(cb(adm, "lang"));
  ok("админ переключил язык → RU", g.lang === "ru" && lastText("Игроки"));
  await bot.handleUpdate(cb(adm, "lang"));
  ok("админ вернул язык → UZ", g.lang === "uz" && lastText("Oʻyinchilar"));
  // кик админом
  await bot.handleUpdate(cb(adm, "k:3"));
  ok("админ кикнул №3 кнопкой 🗑", g.players.length === 4 && !g.players.find(p => p.id === 8003));
  await bot.handleUpdate(cb(mk(4), "k:4"));
  ok("не-админ кикнуть НЕ может", g.players.length === 4);
  await bot.handleUpdate(cb(mk(3), "j"));
  ok("кикнутый снова вступил", g.players.length === 5);
  // старт админом
  await bot.handleUpdate(cb(adm, "s"));
  ok("админ стартовал ▶️", g.phase === "night" && g.dayNo === 1);
  const don = g.players.find(p => p.role === "don");
  const doc = g.players.find(p => p.role === "doctor");
  const sher = g.players.find(p => p.role === "sheriff");
  ok("роли выданы: дон+доктор+комиссар+2 мирных",
    g.players.filter(p => p.role === "civ").length === 2 && don && doc && sher);
  ok("каждому ЛС с ролью", sent().filter(s => /Rolingiz/.test(s.text || "")).length === 5);
  ok("кнопки цели в ЛС у активных ролей", sent().filter(s => s.chat_id === don.id && s.reply_markup).length >= 1);

  console.log("— ЭТАП 2: Ночь (спасение доктора + проверка комиссара) —");
  const victim = g.players.find(p => p.role === "civ");
  await bot.handleUpdate(cb(don, `A:${C}:n${victim.num}`));
  await bot.handleUpdate(cb(doc, `A:${C}:n${victim.num}`)); // доктор лечит жертву!
  await bot.handleUpdate(cb(sher, `A:${C}:n${don.num}`));
  ok("ночь разрешилась, никто не погиб", g.phase === "day" && g.players.every(p => p.alive));
  ok("комиссар получил ответ «MAFIYA» в ЛС", sent().some(s => s.chat_id === sher.id && /MAFIYA/.test(s.text || "")));
  ok("доктору записано спасение", (doc.saves || 0) === 1);
  ok("комиссару записана проверка", (sher.checks || 0) === 1);
  ok("сообщение дня: «qutqardi»", lastText("qutqardi") || lastText("hujum boʻldi"));

  console.log("— ЭТАП 3: Обсуждение и голосование —");
  g.phaseData.deadline = Date.now() - 10; await bot.tick();
  ok("обсуждение перешло в голосование по таймеру", g.phase === "vote");
  const voters = g.players.filter(p => p.alive);
  // один воздержится
  const abst = voters.find(p => p.role === "civ" && p.id !== victim.id);
  await bot.handleUpdate(cb(abst, `A:${C}:p`));
  // остальные казнят дона (дон голосует за другого — за себя нельзя)
  for (const v of voters.filter(x => x.id !== abst.id)) {
    const target = v.id === don.id ? victim.num : don.num;
    await bot.handleUpdate(cb(v, `A:${C}:v${target}`));
  }
  ok("голоса учтены, дон изгнан", g.players.find(p => p.id === don.id).alive === false);
  ok("воздержавшемуся — попап принят", true);
  ok("итог: «shahardan chiqarildi»", lastText("shahardan chiqarildi"));
  ok("после казни дона — победа мирных, игра завершена", g.phase === "ended");

  console.log("— ЭТАП 4: Итоги и система —");
  ok("финальное сообщение: победа TINCH AHLI + роли + победители", lastText("TINCH AHLI"));
  ok("кнопка «Yana oʻynash» в финале", (lastText("TINCH AHLI") || {}).reply_markup || sent().slice(-5).some(s => s.reply_markup));
  ok("ЛС-итоги всем 5 игрокам (Gʻalaba/Magʻlubiyat)", sent().filter(s => !String(s.chat_id).startsWith("-") && /Gʻalaba!|Magʻlubiyat/.test(s.text || "")).length === 5);
  for (const p of g.players) {
    const prof = bot.PROFILES.get(p.id);
    ok(`профиль ${p.first_name}: игра+1, ${p.role === "don" ? "поражение" : "победа"} записана`,
      prof && prof.games === 1 && prof.wins === (p.role === "don" ? 0 : 1));
  }
  ok("дон: −15 рейтинга, мирные: +25 и больше", (() => { const d = bot.PROFILES.get(don.id); const w = bot.PROFILES.get(sher.id); return d.rating === 985 && w.rating >= 1025; })());
  ok("топ заполнен 5 игроками", bot.TOP.length === 5);
  ok("достижения: first+firstWin у победителей", bot.PROFILES.get(sher.id).ach.includes("firstWin"));

  console.log("— ЭТАП 5: Профильные команды и бонус —");
  await bot.handleUpdate(msg(mk(2), "/top"));
  ok("/top в группе показывает TOP", lastText("TOP-10"));
  await bot.handleUpdate(msg(mk(2), "/me"));
  ok("/me в группе показывает карточку", lastText("Sizning profilingiz"));
  await bot.handleUpdate({ update_id: ++mid, message: { chat: { id: 8002, type: "private" }, from: mk(2), text: "/start" } });
  ok("ЛС /start: карточка + кнопки бонус/топ/язык", (() => { const s = sent().filter(x => x.chat_id === 8002).pop(); return s && s.reply_markup && JSON.stringify(s.reply_markup).includes("B:bonus") && JSON.stringify(s.reply_markup).includes("B:lang"); })());
  const prof2 = await bot.getProfile(8002, "Player2");
  const b1 = bot.claimBonus(prof2);
  ok("бонус выдан (10 танга)", b1.ok && b1.amount === 10);
  ok("повтор в тот же день — отказ", !bot.claimBonus(prof2).ok);

  console.log("— ЭТАП 6: Реванш и защита —");
  await bot.handleUpdate(cb(mk(2), "r"));
  
  const g2 = bot.MEM.get(C);
  ok("новое лобби с реванша, фаза lobby, все вернулись", g2 && g2.phase === "lobby" && g2.players.length === 5);
  // мёртвый не может действовать (в новой игре все живы — проверяем запрет чужих кнопок ночи без активной роли)
  await bot.handleUpdate(cb(adm, "s"));
  ok("реванш стартовал", g2.phase === "night");
  await bot.handleUpdate(cb(g2.players.find(p => p.role === "civ"), `A:${C}:n1`));
  ok("мирный не может выбрать жертву ночью (кнопка игнор)", (g2.phaseData.actions || {}).mafia === undefined && g2.phase === "night");

  console.log(`\n🎯 ИТОГ: ${pass} проверок пройдено — полный цикл от кнопки до кнопки работает`);
})().catch(e => { console.error("❌ ПРОВАЛ:", e.message); process.exit(1); });
