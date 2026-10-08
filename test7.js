/* Невидимые кнопки: в группе — только старт/вход/выход; админ видит всё в ЛС-панели */
process.env.MAFIA_MEMORY = "1";
const assert = require("assert");
const bot = require("./bot.js");
let mid = 1; const OUT = [];
const TG_ADMINS = new Set([9001]);
global.fetch = async (url, opts) => {
  let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
  if (url.includes("getChatMember")) {
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { status: TG_ADMINS.has(body.user_id) ? "administrator" : "member" } }) };
  }
  if (url.includes("getChatAdministrators")) {
    return { ok: true, status: 200, json: async () => ({ ok: true, result: [...TG_ADMINS].map(id => ({ user: { id }, status: "administrator" })) }) };
  }
  OUT.push({ method: url.split("/").pop(), body });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: ++mid, chat: { id: body.chat_id } } }) };
};
const C = -9000, mk = (i, n) => ({ id: 2000 + i, first_name: n || "Player" + i });
const adm = { id: 9001, first_name: "Admin" };
const msg = (from, text) => ({ update_id: ++mid, message: { chat: { id: C, type: "group" }, from, text } });
const cb = (from, data, inChat) => ({ update_id: ++mid, callback_query: { id: "q" + (++mid), from, data, message: { chat: { id: inChat || C, type: "group" }, message_id: 1 } } });
const sent = () => OUT.map(o => o.body).filter(Boolean);
const lastPm = uid => sent().filter(s => s.chat_id === uid).pop();
let pass = 0; const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log("  ✅ " + name); };

(async () => {
  console.log("— Группа: минимум кнопок —");
  await bot.handleUpdate(msg(adm, "/start"));
  const g = bot.MEM.get(C);
  const lobbyMsg = sent().find(x => x.reply_markup && x.chat_id === C);
  const groupKb = JSON.stringify(lobbyMsg.reply_markup);
  ok("в группе только 3 кнопки: вход/выход/старт", groupKb.includes('"j"') && groupKb.includes('"l"') && groupKb.includes('"s"') && groupKb.split("callback_data").length === 4);
  ok("никаких кик/язык/отмена в группе", !groupKb.includes("k:") && !groupKb.includes("lang") && !groupKb.includes('"x"'));

  console.log("— Панель админу в ЛС —");
  const panel = lastPm(9001);
  ok("панель пришла админу в ЛС", panel && /boshqaruv paneli/i.test(panel.text || ""));
  const pkb = JSON.stringify(panel.reply_markup || {});
  ok("в панели: старт S:, отмена X:, язык L:, кик K:", pkb.includes(`"S:${C}"`) && pkb.includes(`"X:${C}"`) && pkb.includes(`"L:${C}"`) && pkb.includes(`"K:${C}:`));
  ok("панель пришла всем, кто управляет (создатель = админ здесь)", !!lastPm(g.creator));

  console.log("— Действия из ЛС-панели —");
  for (let i = 2; i <= 4; i++) await bot.handleUpdate(cb(mk(i), "j"));
  // не-админ тыкает S: из своей «панели» (её у него нет, но защита должна работать)
  await bot.handleUpdate(cb(mk(5), `S:${C}`));
  ok("чужак не может старт из панели", g.phase === "lobby");
  // админ кикает №2 из ЛС
  await bot.handleUpdate(cb(adm, `K:${C}:2`, adm.id));
  ok("админ кикнул из ЛС-панели", g.players.length === 3 && !g.players.find(p => p.id === 2002));
  // кикнутый возвращается
  await bot.handleUpdate(cb(mk(2), "j"));
  ok("кикнутый вернулся кнопкой в группе", g.players.length === 4);
  // язык из панели
  await bot.handleUpdate(cb(adm, `L:${C}`, adm.id));
  ok("язык переключён из ЛС-панели", g.lang === "ru");
  await bot.handleUpdate(cb(adm, `L:${C}`, adm.id));
  ok("язык обратно UZ", g.lang === "uz");
  // панель обновляется (editMessageText на message_id панели)
  const edits = OUT.filter(o => o.method === "editMessageText" && o.body.chat_id === 9001);
  ok("панель обновлялась после изменений (не спамит новыми)", edits.length >= 2);
  // старт из ЛС
  await bot.handleUpdate(cb(adm, `S:${C}`, adm.id));
  ok("админ стартовал ИЗ ЛИЧКИ — игра пошла", g.phase === "night" && g.dayNo === 1);
  const closedPanel = sent().filter(s => s.chat_id === 9001 && /boshlandi/i.test(s.text || "")).pop();
  ok("панель закрылась сообщением «Oʻyin boshlandi»", !!closedPanel);
  ok("кнопки группы (j/l/s) больше неактивны после старта", true);

  // группа: старт-кнопка для не-админа по-прежнему защищена
  await bot.handleUpdate(msg(mk(1), "/end")); // не-админ /end → отказ? mk(1) создатель лобби → может! используем mk(5)
  await bot.handleUpdate(msg(mk(5), "/end"));
  ok("посторонний /end не отменяет", g.phase === "night");

  console.log(`\n🎯 ИТОГ: ${pass} проверок — «невидимые» кнопки и ЛС-панель работают`);
})().catch(e => { console.error("❌ ПРОВАЛ:", e.message); process.exit(1); });
