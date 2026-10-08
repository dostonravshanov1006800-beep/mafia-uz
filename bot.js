/* ============================================================
   Mafia UZ — игровая Мафия в Telegram (@mafiauzs_bot)
   Бесплатная инфраструктура: GitHub Actions (поллинг-эстафета),
   состояние игр — зашифрованные файлы в этом же репозитории.
   ============================================================ */
"use strict";

const TOKEN = process.env.MAFIA_BOT_TOKEN;
const RUN_MS = (parseInt(process.env.RUN_MS, 10) || 270) * 1000;
const API = (m, o) => `https://api.telegram.org/bot${TOKEN}/${m}`;
const IS_MAIN = typeof require !== "undefined" && require.main === module;

/* ---------- GitHub как хранилище (шифрованное) ---------- */
const GH_REPO = process.env.GH_REPO || "dostonravshanov1006800-beep/mafia-uz";
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_ACCESS_TOKEN || "";
const GH_API = "https://api.github.com";
const MEMORY_MODE = process.env.MAFIA_MEMORY === "1"; // для тестов
const STATE_DIR = "games";

const crypto = require("crypto");
function cipher() {
  const key = Buffer.from((process.env.MAFIA_STATE_KEY || "").padEnd(64, "0"), "hex");
  return { key };
}
function encState(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", cipher().key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final(), c.getAuthTag()]);
  return Buffer.concat([iv, ct]).toString("base64");
}
function decState(b64) {
  const raw = Buffer.from(b64, "base64");
  const iv = raw.slice(0, 12), tag = raw.slice(raw.length - 16), ct = raw.slice(12, raw.length - 16);
  const d = crypto.createDecipheriv("aes-256-gcm", cipher().key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
}

async function gh(path, opts = {}) {
  const r = await fetch(GH_API + path, {
    ...opts,
    headers: {
      "Authorization": `token ${GH_TOKEN}`, "Accept": "application/vnd.github+json",
      "Content-Type": "application/json", "User-Agent": "mafia-uz",
      ...(opts.headers || {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GH ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

const MEM = new Map(); // chatId -> game (runtime кэш)
const SHA = new Map(); // chatId -> file sha
const SAVEQ = new Map(); // chatId -> promise chain (сериализация записей)

async function loadAll() {
  if (MEMORY_MODE) return;
  try {
    const ls = await gh(`/repos/${GH_REPO}/contents/${STATE_DIR}`);
    if (!Array.isArray(ls)) return;
    for (const f of ls) {
      try {
        const g = decState(Buffer.from(f.content, "base64").toString("utf8"));
        if (g && g.phase !== "ended") { MEM.set(g.chatId, g); SHA.set(g.chatId, f.sha); }
      } catch (e) { /* битый файл — пропускаем */ }
    }
    log(`загружено игр: ${MEM.size}`);
  } catch (e) { log("loadAll: " + e.message); }
}

async function persist(game) {
  if (MEMORY_MODE) return;
  let chain = SAVEQ.get(game.chatId) || Promise.resolve();
  const p = chain.then(async () => {
    const path = `/repos/${GH_REPO}/contents/${STATE_DIR}/${game.chatId}.json`;
    let sha = SHA.get(game.chatId);
    if (!sha) {
      const cur = await gh(path);
      if (cur) { sha = cur.sha; try { const g = decState(Buffer.from(cur.content, "base64").toString("utf8")); Object.assign(game, g); } catch (e) {} }
    }
    const body = { message: `state ${game.chatId}`, content: Buffer.from(encState(game)).toString("base64"), ...(sha ? { sha } : {}) };
    const r = await gh(path, { method: "PUT", body: JSON.stringify(body) });
    SHA.set(game.chatId, r.content.sha);
  }).catch(e => log("persist " + e.message));
  SAVEQ.set(game.chatId, p);
  return p;
}

function gameOf(chatId) { return MEM.get(chatId); }
function putGame(g) { MEM.set(g.chatId, g); return persist(g); }

/* ---------- Тексты RU / UZ ---------- */
const T = {
  lobbyTitle:   { ru: "🎭 Мафия — набор игроков", uz: "🎭 Mafiya — oʻyinchilar yigʻilmoqda" },
  lobbyPlayers: { ru: "Игроки", uz: "Oʻyinchilar" },
  lobbyMin:     { ru: "Минимум 4 игрока. Жмите «➕ Вступить»!", uz: "Kamida 4 oʻyinchi kerak. «➕ Qoʻshilish»ni bosing!" },
  lobbyCreator: { ru: "Создатель игры", uz: "Oʻyin yaratuvchisi" },
  lobbyJoined:  { ru: "✅ Вы в игре!", uz: "✅ Siz oʻyindasiz!" },
  btnJoin:      { ru: "➕ Вступить", uz: "➕ Qoʻshilish" },
  btnLeave:     { ru: "➖ Выйти", uz: "➖ Chiqish" },
  btnStart:     { ru: "▶️ Начать игру", uz: "▶️ Oʻyinni boshlash" },
  btnCancel:    { ru: "❌ Отменить", uz: "❌ Bekor qilish" },
  btnAgain:     { ru: "🎲 Играть снова", uz: "🎲 Yana oʻynash" },
  noCreator:    { ru: "Это может только создатель игры.", uz: "Buni faqat oʻyin yaratuvchisi qilishi mumkin." },
  started:      { ru: "🎭 Игра началась! Роли отправлены в личные сообщения. Проверьте личку — если её нет, нажмите /start у бота.", uz: "🎭 Oʻyin boshlandi! Rollar shaxsiy xabarda yuborildi. Shaxsiy chatni tekshiring — boʻlmasa botga /start bosing." },
  nightTitle:   { ru: "🌙 НОЧЬ {n}. Город засыпает...", uz: "🌙 TUN {n}. Shahar uxlay boshlaydi..." },
  nightWait:    { ru: "⏳ Мафия выбирает жертву, доктор готовит скальпель, комиссар идёт по следу...", uz: "⏳ Mafiya qurbonni tanlamoqda, doktor tayyorlanmoqda, komissar izlamoqda..." },
  nightLeft:    { ru: "осталось {s} сек", uz: "{s} sekund qoldi" },
  yourRole:     { ru: "🎭 Ваша роль: <b>{role}</b>\n\n{desc}", uz: "🎭 Sizning rol: <b>{role}</b>\n\n{desc}" },
  nightMafia:   { ru: "🔪 Вы — мафия. Выберите жертву:", uz: "🔪 Siz — mafiya. Qurbonni tanlang:" },
  nightDoctor:  { ru: "💊 Вы — доктор. Кого лечить этой ночью?", uz: "💊 Siz — doktor. Bu kecha kimga davolash?" },
  nightSheriff: { ru: "🕵️ Вы — комиссар. Кого проверить?", uz: "🕵️ Siz — komissar. Kimni tekshirish?" },
  chooseTarget:  { ru: "Выберите игрока:", uz: "Oʻyinchini tanlang:" },
  passNight:    { ru: "😴 Пропустить", uz: "😴 Oʻtkazib yuborish" },
  actDone:      { ru: "✅ Принято.", uz: "✅ Qabul qilindi." },
  dayTitle:     { ru: "☀️ ДЕНЬ {n}. Город просыпается!", uz: "☀️ KUN {n}. Shahar uygʻonadi!" },
  diedNight:    { ru: "☠️ Убит этой ночью: <b>{name}</b> — был(а) {role}.", uz: "☠️ Bu kecha oʻldirilgan: <b>{name}</b> — {role} edi." },
  savedNight:   { ru: "💊 Ночью было покушение, но доктор спас жертву! Никто не погиб.", uz: "💊 Tun hujum boʻldi, lekin doktor qutqardi! Hech kim halok boʻlmadi." },
  noKill:       { ru: "😴 Ночь прошла спокойно. Никто не погиб.", uz: "😴 Tun tinch oʻtdi. Hech kim halok boʻlmadi." },
  discuss:      { ru: "🗣 Обсуждение! Кто мафия? У вас {s} секунд.", uz: "🗣 Munozara! Kim mafiya? Sizda {s} sekund bor." },
  voteAsk:      { ru: "⚖️ Голосование! Кого казнить?", uz: "⚖️ Ovoz berish! Kimni surgun qilish?" },
  votePM:       { ru: "⚖️ Голосуйте, кого казнить сегодня:", uz: "⚖️ Bugun kimni surgun qilish uchun ovoz bering:" },
  passVote:     { ru: "🤷 Воздержаться", uz: "🤷 Ovoz bermaslik" },
  voteLeft:     { ru: "Голосов: {c}/{t}. Осталось {s} сек.", uz: "Ovozlar: {c}/{t}. {s} sekund qoldi." },
  lynched:      { ru: "☠️ Город решил: <b>{name}</b> казнён — был(а) {role}.", uz: "☠️ Shahar qarori: <b>{name}</b> surgun qilindi — {role} edi." },
  noLynch:      { ru: "🤷 Город не смог решить. Никого не казнили.", uz: "🤷 Shahar qaror qila olmadi. Hech kim surgun qilinmadi." },
  winMafia:     { ru: "🏆 МАФИЯ ПОБЕДИЛА!", uz: "🏆 MAFIYA GʻALABA QILDI!" },
  winCiv:       { ru: "🏆 МИРНЫЕ ПОБЕДИЛИ! Вся мафия уничтожена.", uz: "🏆 TINCH AHLI GʻALABA QILDI! Barcha mafiya yoʻq qilindi." },
  rolesWere:    { ru: "🎭 Роли:", uz: "🎭 Rollar:" },
  gameCancelled: { ru: "❌ Игра отменена.", uz: "❌ Oʻyin bekor qilindi." },
  helpGroup:    { ru: "👉 Добавьте меня в группу и нажмите «Новая игра».", uz: "👉 Meni guruhga qoʻshing va «Yangi oʻyin»ni bosing." },
  helpPM:       { ru: "👋 Я — <b>Mafia UZ</b>, игровая Мафия в Telegram.\n\nСоберите 4–10 друзей в группе — и я стану ведущим: раздам роли, буду вести ночи и дни, голосование и таймеры.\n\n👉 Добавьте меня в группу и напишите /start (или нажмите кнопку ниже).\n\nЯ говорю на 🇷🇺 и 🇺🇿.", uz: "👋 Men — <b>Mafia UZ</b>, Telegramdagi Mafiya oʻyini.\n\nGuruhda 4–10 doʻstni yigʻing — men boshqaruvchi boʻlaman: rollar tarqataman, tun va kunlarni, ovoz berish va taymerlarni olib boraman.\n\n👉 Meni guruhga qoʻshing va /start yozing (yoki pastdagi tugmani bosing).\n\nMen 🇷🇺 va 🇺🇿 tillarida gaplashaman." },
  newGame:      { ru: "🎲 Новая игра", uz: "🎲 Yangi oʻyin" },
  pmBlocked:    { ru: "⚠️ {name}, откройте личку с ботом (напишите мне /start), иначе не сможете играть.", uz: "⚠️ {name}, botga shaxsiy chatni oching (menga /start yozing), aks holda oʻyinlay olmaysiz." },
  tooFew:       { ru: "❌ Нужно минимум 4 игрока.", uz: "❌ Kamida 4 oʻyinchi kerak." },
  tooMany:      { ru: "❌ Максимум 10 игроков.", uz: "❌ Maksimum 10 oʻyinchi." },
  notInGame:    { ru: "Вы не в игре.", uz: "Siz oʻyinda emassiz." },
  deadNoAct:    { ru: "💀 Мёртвые молчат 😏", uz: "💀 Oʻliklar jim turadi 😏" },
  alreadyVoted: { ru: "Голос уже учтён.", uz: "Ovoz allaqachon qabul qilindi." },
  sheriffMafia: { ru: "🚨 <b>Это МАФИЯ!</b>", uz: "🚨 <b>Bu MAFIYA!</b>" },
  sheriffCiv:   { ru: "😌 Не мафия.", uz: "😌 Mafiya emas." },
  cantVoteSelf: { ru: "За себя голосовать нельзя.", uz: "Oʻzingizga ovoz berib boʻlmaydi." },
  gameExists:   { ru: "Здесь уже идёт игра или набор.", uz: "Bu yerda oʻyin allaqachon davom etmoqda." },
  langSet:     { ru: "🇷🇺 Русский", uz: "🇺🇿 Oʻzbek" },
};

/* Роли */
const ROLES = {
  don:     { ru: "🎯 Дон Мафии", uz: "🎯 Mafiya Doni",
             ruD: "Ночью выбираете жертву. Днём скрывайтесь среди мирных.", uzD: "Tunda qurbonni tanlaysiz. Kunduzi tinchlar orasida yashirining." },
  mafia:   { ru: "🔪 Мафия", uz: "🔪 Mafiya",
             ruD: "Ночью выбираете жертву. Днём скрывайтесь среди мирных.", uzD: "Tunda qurbonni tanlaysiz. Kunduzi tinchalar orasida yashirining." },
  sheriff: { ru: "🕵️ Комиссар", uz: "🕵️ Komissar",
             ruD: "Каждую ночь проверяете одного игрока: мафия он или нет.", uzD: "Har tunda bitta oʻyinchini tekshirasiz: mafiya yoki yoʻq." },
  doctor:  { ru: "💊 Доктор", uz: "💊 Doktor",
             ruD: "Каждую ночь спасаете одного игрока (можно себя) от мафии.", uzD: "Har tunda bitta oʻyinchini qutqarasiz (oʻzingizni ham)" },
  civ:     { ru: "👤 Мирный житель", uz: "👤 Tinch aholi",
             ruD: "Днём ищите мафию и голосуйте. Ночью — спите и верьте в доктора.", uzD: "Kunduzi mafiyani qidiring va ovoz bering. Tunda uxlang." },
};
const ROLE_KEY = { don: "don", mafia: "mafia", sheriff: "sheriff", doctor: "doctor", civ: "civ" };
function roleName(r, lang) { const x = ROLES[r]; return lang === "uz" ? x.uz : x.ru; }
function roleDesc(r, lang) { return lang === "uz" ? ROLES[r].uzD : ROLES[r].ruD; }

function t(game, key, vars) {
  let s = (T[key] && (T[key][game ? game.lang : "ru"] || T[key].ru)) || key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function log(m) { console.log(new Date().toISOString().slice(11, 19), m); }

/* ---------- Telegram API ---------- */
async function tg(method, params) {
  try {
    const r = await fetch(API(method), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
    });
    const j = await r.json().catch(() => ({}));
    if (j && j.ok) return j.result;
    throw new Error(j.description || `HTTP ${r.status}`);
  } catch (e) { throw e; }
}

/* ---------- Игровая логика ---------- */
function numPlayers(g) { return g.players.length; }
function alive(g) { return g.players.filter(p => p.alive); }
function aliveCiv(g) { return g.players.filter(p => p.alive && !["don", "mafia"].includes(p.role)); }
function aliveMafia(g) { return g.players.filter(p => p.alive && ["don", "mafia"].includes(p.role)); }
function byNum(g, n) { return g.players.find(p => p.num === n); }
function pName(p) { return esc(p.name || p.username || ("#" + p.num)); }

function mafiaCount(n) { return n <= 5 ? 1 : n <= 9 ? 2 : 3; }

function distributeRoles(g) {
  const ps = [...g.players];
  for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
  const m = mafiaCount(ps.length);
  ps.forEach((p, i) => {
    if (i === 0) p.role = "don";
    else if (i < m) p.role = "mafia";
    else if (i === m) p.role = "sheriff";
    else if (i === m + 1) p.role = "doctor";
    else p.role = "civ";
    p.alive = true;
  });
}

function lobbyText(g) {
  const L = g.lang;
  const lines = g.players.map(p => `${p.num}. ${pName(p)}${p.id === g.creator ? " 👑" : ""}`).join("\n");
  const need = numPlayers(g) < 4 ? "\n\n" + t(g, "lobbyMin") : "";
  return `${t(g, "lobbyTitle")}\n\n<b>${t(g, "lobbyPlayers")} (${numPlayers(g)}/10):</b>\n${lines || "—"}${need}`;
}
function lobbyKb(g) {
  const inGame = g.players.length > 0;
  const kb = [];
  kb.push([{ text: t(g, "btnJoin"), callback_data: "j" }, { text: t(g, "btnLeave"), callback_data: "l" }]);
  const row2 = [{ text: t(g, "btnStart"), callback_data: "s" }];
  if (g.creator) row2.push({ text: t(g, "btnCancel"), callback_data: "x" });
  kb.push(row2);
  kb.push([{ text: t(g, "langSet"), callback_data: "lang" }]);
  return { inline_keyboard: kb };
}

async function createLobby(chatId, from) {
  const g = {
    chatId, phase: "lobby", lang: "uz", creator: from.id, msgId: 0,
    players: [], dayNo: 0, phaseData: {}, created: Date.now(),
  };
  const m = await tg("sendMessage", { chat_id: chatId, text: lobbyText(g), parse_mode: "HTML", reply_markup: lobbyKb(g) });
  g.msgId = m.message_id;
  await putGame(g);
  await tryJoin(g, from);
  return g;
}

async function tryJoin(g, from) {
  if (g.players.find(p => p.id === from.id)) return false;
  if (g.players.length >= 10) return false;
  g.players.push({ id: from.id, num: g.players.length + 1, name: from.first_name || from.username || "Player", username: from.username || "", role: null, alive: true });
  await refreshLobby(g);
  return true;
}
async function refreshLobby(g) {
  try { await tg("editMessageText", { chat_id: g.chatId, message_id: g.msgId, text: lobbyText(g), parse_mode: "HTML", reply_markup: lobbyKb(g) }); }
  catch (e) { const m = await tg("sendMessage", { chat_id: g.chatId, text: lobbyText(g), parse_mode: "HTML", reply_markup: lobbyKb(g) }); g.msgId = m.message_id; }
}

async function startGame(g) {
  if (numPlayers(g) < 4) return { ok: false, why: "few" };
  distributeRoles(g);
  // личные сообщения с ролями
  const failed = [];
  for (const p of g.players) {
    try {
      await tg("sendMessage", {
        chat_id: p.id,
        text: t(g, "yourRole", { role: roleName(p.role, g.lang), desc: roleDesc(p.role, g.lang) }),
        parse_mode: "HTML",
      });
    } catch (e) { failed.push(p); }
  }
  if (failed.length) {
    for (const p of failed) {
      await tg("sendMessage", { chat_id: g.chatId, text: t(g, "pmBlocked", { name: pName(p) }), parse_mode: "HTML" }).catch(() => {});
      g.players = g.players.filter(x => x.id !== p.id);
    }
    g.players.forEach((p, i) => p.num = i + 1);
    if (numPlayers(g) < 4) {
      await tg("sendMessage", { chat_id: g.chatId, text: t(g, "tooFew") }).catch(() => {});
      g.phase = "ended"; await putGame(g); return { ok: false };
    }
    for (const p of g.players) {
      await tg("sendMessage", { chat_id: p.id, text: t(g, "yourRole", { role: roleName(p.role, g.lang), desc: roleDesc(p.role, g.lang) }), parse_mode: "HTML" }).catch(() => {});
    }
  }
  await tg("sendMessage", { chat_id: g.chatId, text: t(g, "started"), parse_mode: "HTML" }).catch(() => {});
  await beginNight(g);
  return { ok: true };
}

/* ---------- Фазы ---------- */
async function beginNight(g) {
  g.phase = "night"; g.dayNo++;
  g.phaseData = { actions: {}, deadline: Date.now() + 60_000, shown: 999 };
  await putGame(g);
  const m = await tg("sendMessage", {
    chat_id: g.chatId,
    text: `${t(g, "nightTitle", { n: g.dayNo })}\n${t(g, "nightWait")}`,
    parse_mode: "HTML",
  });
  g.statusMsgId = m.message_id;
  // личные действия
  for (const p of alive(g)) {
    if (["don", "mafia"].includes(p.role)) await pmTargetChoice(g, p, "nightMafia", "n", alive(g).filter(x => !["don","mafia"].includes(x.role)));
    else if (p.role === "doctor") await pmTargetChoice(g, p, "nightDoctor", "n", alive(g));
    else if (p.role === "sheriff") await pmTargetChoice(g, p, "nightSheriff", "n", alive(g).filter(x => x.id !== p.id));
  }
  await putGame(g);
}

async function pmTargetChoice(g, p, introKey, prefix, targets) {
  const kb = { inline_keyboard: [] };
  targets.forEach(x => {
    const last = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    const btn = { text: `${x.num} ${x.name.slice(0, 14)}`, callback_data: `A:${g.chatId}:${prefix}${x.num}` };
    if (!last || last.length >= 3) kb.inline_keyboard.push([btn]); else last.push(btn);
  });
  kb.inline_keyboard.push([{ text: t(g, prefix === "v" ? "passVote" : "passNight"), callback_data: `A:${g.chatId}:p` }]);
  await tg("sendMessage", { chat_id: p.id, text: t(g, introKey) + "\n" + t(g, "chooseTarget"), parse_mode: "HTML", reply_markup: kb }).catch(async (e) => {
    await tg("sendMessage", { chat_id: g.chatId, text: t(g, "pmBlocked", { name: pName(p) }), parse_mode: "HTML" }).catch(() => {});
  });
}

function nightDone(g) {
  const a = g.phaseData.actions;
  return !!(a.mafia || a.mafiaPass);
}
function allVoted(g) {
  return alive(g).every(p => g.phaseData.votes[p.id] !== undefined);
}

async function tick() {
  const now = Date.now();
  for (const g of [...MEM.values()]) {
    try {
      if (g.phase === "night" && now > g.phaseData.deadline) await resolveNight(g);
      else if (g.phase === "night" || g.phase === "day" || g.phase === "vote") {
        const left = Math.ceil((g.phaseData.deadline - now) / 1000);
        const marks = g.phase === "day" ? [60, 30, 10] : [30, 10];
        for (const mk of marks) {
          if (left <= mk && g.phaseData.shown > mk && left > 0) {
            g.phaseData.shown = mk;
            await updateStatus(g, left);
            await putGame(g);
            break;
          }
        }
      }
      if (g.phase === "day" && now > g.phaseData.deadline) await beginVote(g);
      if (g.phase === "vote" && (now > g.phaseData.deadline || allVoted(g))) await resolveVote(g);
    } catch (e) { log("tick " + e.message); }
  }
}

async function updateStatus(g, leftSec) {
  if (!g.statusMsgId) return;
  const body = g.phase === "day"
    ? t(g, "discuss", { s: leftSec })
    : g.phase === "vote" ? t(g, "voteLeft", { c: Object.keys(g.phaseData.votes).length, t: alive(g).length, s: leftSec })
    : `${t(g, "nightTitle", { n: g.dayNo })}\n${t(g, "nightLeft", { s: leftSec })}`;
  try {
    await tg("editMessageText", { chat_id: g.chatId, message_id: g.statusMsgId, text: body, parse_mode: "HTML" });
  } catch (e) {}
}

async function resolveNight(g) {
  const a = g.phaseData.actions || {};
  const victim = a.mafia ? byNum(g, a.mafia) : null;
  const healed = a.doctor ? byNum(g, a.doctor) : null;
  if (a.sheriff) {
    const target = byNum(g, a.sheriff);
    const p = g.players.find(x => ["don", "mafia"].includes(x.role) && x.num === target?.num);
    const who = g.players.find(x => x.role === "sheriff");
    if (who && target) {
      await tg("sendMessage", {
        chat_id: who.id,
        text: `<b>${pName(target)}</b> → ${p ? t(g, "sheriffMafia") : t(g, "sheriffCiv")}`,
        parse_mode: "HTML",
      }).catch(() => {});
    }
  }
  let dayText = `${t(g, "dayTitle", { n: g.dayNo })}\n\n`;
  if (victim && healed && victim.id === healed.id) {
    dayText += t(g, "savedNight");
  } else if (victim) {
    victim.alive = false;
    dayText += t(g, "diedNight", { name: pName(victim), role: roleName(victim.role, g.lang) });
  } else {
    dayText += t(g, "noKill");
  }
  // проверка победы
  const w = checkWin(g);
  if (w) return endGame(g, w);
  g.phase = "day";
  g.phaseData = { deadline: Date.now() + 90_000, shown: 999, votes: {} };
  await putGame(g);
  const m = await tg("sendMessage", { chat_id: g.chatId, text: dayText + "\n\n" + t(g, "discuss", { s: 90 }), parse_mode: "HTML" });
  g.statusMsgId = m.message_id;
  await putGame(g);
}

async function beginVote(g) {
  g.phase = "vote";
  g.phaseData = { votes: {}, deadline: Date.now() + 60_000, shown: 999 };
  await putGame(g);
  const m = await tg("sendMessage", { chat_id: g.chatId, text: t(g, "voteAsk"), parse_mode: "HTML" });
  g.statusMsgId = m.message_id;
  for (const p of alive(g)) {
    await pmTargetChoice(g, p, "votePM", "v", alive(g).filter(x => x.id !== p.id));
  }
}

async function resolveVote(g) {
  const votes = g.phaseData.votes || {};
  const tally = {};
  let count = 0;
  for (const voterId of Object.keys(votes)) {
    const n = votes[voterId];
    if (n === "pass") continue;
    count++;
    tally[n] = (tally[n] || 0) + 1;
  }
  let lynched = null, max = 0, tie = false;
  for (const n of Object.keys(tally)) {
    if (tally[n] > max) { max = tally[n]; lynched = byNum(g, +n); tie = false; }
    else if (tally[n] === max) tie = true;
  }
  if (lynched && !tie) {
    lynched.alive = false;
    var text = t(g, "lynched", { name: pName(lynched), role: roleName(lynched.role, g.lang) });
  } else {
    var text = t(g, "noLynch");
  }
  const w = checkWin(g);
  if (w) return endGame(g, w, text + "\n\n");
  await tg("sendMessage", { chat_id: g.chatId, text, parse_mode: "HTML" }).catch(() => {});
  await beginNight(g);
}

function checkWin(g) {
  if (aliveMafia(g).length === 0) return "civ";
  if (aliveMafia(g).length >= aliveCiv(g).length) return "mafia";
  return null;
}

async function endGame(g, winner, prefix = "") {
  g.phase = "ended";
  const roles = g.players.map(p => `${p.num}. ${pName(p)} — ${roleName(p.role, g.lang)}${p.alive ? " ✅" : " ☠️"}`).join("\n");
  const text = prefix + `<b>${winner === "mafia" ? t(g, "winMafia") : t(g, "winCiv")}</b>\n\n<b>${t(g, "rolesWere")}</b>\n${roles}`;
  try {
    await tg("editMessageText", { chat_id: g.chatId, message_id: g.statusMsgId, text, parse_mode: "HTML" });
  } catch (e) {
    await tg("sendMessage", { chat_id: g.chatId, text, parse_mode: "HTML" });
  }
  await tg("sendMessage", {
    chat_id: g.chatId, text: t(g, "btnAgain"),
    reply_markup: { inline_keyboard: [[{ text: t(g, "btnAgain"), callback_data: "r" }]] },
  }).catch(() => {});
  await putGame(g);
  MEM.delete(g.chatId); // держим только активные; ended остаётся в файле... перезайти через r-кнопку ниже
  MEM.set(g.chatId, g); // callback "r" должен найти игру
}

/* ---------- Обработчики ---------- */
async function onMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const from = msg.from;
  if (!from || from.is_bot) return;

  if (msg.chat.type === "private") {
    if (text.startsWith("/start") || text.startsWith("/help")) {
      const kb = { inline_keyboard: [[{ text: t(null, "newGame"), url: `https://t.me/mafiauzs_bot?startgroup=mafia` }]] };
      await tg("sendMessage", { chat_id: chatId, text: t({ lang: "ru" }, "helpPM"), parse_mode: "HTML", reply_markup: kb });
      // UZ версия вторым сообщением для UZ-аудитории? Нет: /start на RU, язык переключается в лобби.
    }
    return;
  }

  // групповой чат
  if (text.startsWith("/start") || text.startsWith("/newgame") || text.startsWith("игра") || text.startsWith("oʻyin") || text.startsWith("oyin")) {
    let g = gameOf(chatId);
    if (g && g.phase !== "ended") {
      await tg("sendMessage", { chat_id: chatId, text: t(g, "gameExists") }).catch(() => {});
      return;
    }
    if (g && g.phase === "ended") { MEM.delete(chatId); }
    await createLobby(chatId, from);
  } else if (text.startsWith("/end") || text.startsWith("/stop")) {
    const g = gameOf(chatId);
    if (g && g.creator === from.id) {
      g.phase = "ended";
      await tg("sendMessage", { chat_id: chatId, text: t(g, "gameCancelled") }).catch(() => {});
      await putGame(g); MEM.delete(chatId);
    }
  }
}

async function onCallback(q) {
  const from = q.from;
  const data = q.data || "";
  const chatId = q.message.chat.id;
  const isGroup = q.message.chat.type !== "private";

  try {
    // ---- личные игровые действия: A:<gameChatId>:<action>
    if (data.startsWith("A:")) {
      const parts = data.split(":");
      const g = gameOf(+parts[1]);
      if (!g) return void (await tg("answerCallbackQuery", { callback_query_id: q.id }));
      const act = parts[2];
      const p = g.players.find(x => x.id === from.id);
      if (!p) return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "notInGame") }));
      if (!p.alive) return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "deadNoAct") }));

      if (act.startsWith("n")) { // ночное действие
        const targetNum = +act.slice(1);
        if (g.phase !== "night") return void (await tg("answerCallbackQuery", { callback_query_id: q.id }));
        const role = p.role;
        if (!["don", "mafia", "doctor", "sheriff"].includes(role)) return void (await tg("answerCallbackQuery", { callback_query_id: q.id }));
        const a = g.phaseData.actions;
        if (role === "don") a.mafia = targetNum;
        if (role === "mafia") { if (!a.mafia) a.mafia = targetNum; else return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "alreadyVoted") })); }
        if (role === "doctor") a.doctor = targetNum;
        if (role === "sheriff") a.sheriff = targetNum;
        await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "actDone") });
        await putGame(g);
        if (nightDone(g) && a.doctor !== undefined && a.sheriff !== undefined && a.mafia !== undefined) { /* ждём всех или таймер */ }
        // ночь завершается по таймеру либо когда все активные роли отметились
        const need = [];
        for (const x of alive(g)) {
          if (x.role === "don" || (x.role === "mafia" && !a.mafia)) need.push("m");
          if (x.role === "doctor") need.push("d");
          if (x.role === "sheriff") need.push("s");
        }
        const mafiaSet = a.mafia !== undefined;
        const doctorSet = a.doctor !== undefined || !alive(g).some(x => x.role === "doctor");
        const sheriffSet = a.sheriff !== undefined || !alive(g).some(x => x.role === "sheriff");
        if (mafiaSet && doctorSet && sheriffSet) await resolveNight(g);
      } else if (act.startsWith("v")) { // голосование днём
        if (g.phase !== "vote") return void (await tg("answerCallbackQuery", { callback_query_id: q.id }));
        const targetNum = +act.slice(1);
        if (targetNum === p.num) return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "cantVoteSelf") }));
        g.phaseData.votes[from.id] = targetNum;
        await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "actDone") });
        await putGame(g);
        if (allVoted(g)) await resolveVote(g);
      } else if (act === "p") { // пропустить/воздержаться
        if (g.phase === "night") {
          const a = g.phaseData.actions;
          if (["don", "mafia"].includes(p.role) && a.mafia === undefined) a.mafiaPass = true, a.mafia = undefined;
          if (p.role === "doctor") a.doctor = null;
          if (p.role === "sheriff") a.sheriff = null;
          await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "actDone") });
          await putGame(g);
          const doctorSet = a.doctor !== undefined || !alive(g).some(x => x.role === "doctor");
          const sheriffSet = a.sheriff !== undefined || !alive(g).some(x => x.role === "sheriff");
          const mafiaSet = a.mafia !== undefined || a.mafiaPass || !alive(g).some(x => ["don","mafia"].includes(x.role));
          if (mafiaSet && doctorSet && sheriffSet) await resolveNight(g);
        } else if (g.phase === "vote") {
          g.phaseData.votes[from.id] = "pass";
          await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "actDone") });
          await putGame(g);
          if (allVoted(g)) await resolveVote(g);
        }
      }
      return;
    }

    // ---- групповые кнопки лобби
    const g = gameOf(chatId);
    if (data === "j") {
      if (!g) return;
      if (g.phase !== "lobby") return void (await tg("answerCallbackQuery", { callback_query_id: q.id }));
      if (g.players.length >= 10) return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "tooMany") }));
      await tryJoin(g, from);
      await putGame(g);
      await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "lobbyJoined") });
    } else if (data === "l") {
      if (!g || g.phase !== "lobby") return;
      g.players = g.players.filter(p => p.id !== from.id);
      g.players.forEach((p, i) => p.num = i + 1);
      await refreshLobby(g);
      await putGame(g);
      await tg("answerCallbackQuery", { callback_query_id: q.id });
    } else if (data === "s") {
      if (!g) return;
      if (from.id !== g.creator) return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "noCreator") }));
      if (numPlayers(g) < 4) return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "tooFew") }));
      await tg("answerCallbackQuery", { callback_query_id: q.id });
      await startGame(g);
    } else if (data === "x") {
      if (!g) return;
      if (from.id !== g.creator) return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "noCreator") }));
      g.phase = "ended";
      await tg("sendMessage", { chat_id: chatId, text: t(g, "gameCancelled") }).catch(() => {});
      await putGame(g);
      MEM.delete(chatId);
      await tg("answerCallbackQuery", { callback_query_id: q.id });
    } else if (data === "lang") {
      if (!g || g.phase !== "lobby") return;
      g.lang = g.lang === "uz" ? "ru" : "uz";
      await refreshLobby(g);
      await putGame(g);
      await tg("answerCallbackQuery", { callback_query_id: q.id, text: g.lang === "uz" ? "🇺🇿 Oʻzbek" : "🇷🇺 Русский" });
    } else if (data === "r") { // играть снова
      if (!g) return;
      const old = g.players.map(p => ({ ...p }));
      MEM.delete(chatId);
      const ng = await createLobby(chatId, { id: from.id, first_name: from.first_name, username: from.username });
      for (const p of old) { if (p.id !== from.id) await tryJoin(ng, { id: p.id, first_name: p.name, username: p.username }); }
      await putGame(ng);
      await tg("answerCallbackQuery", { callback_query_id: q.id });
    }
  } catch (e) {
    log("cb " + e.message);
    try { await tg("answerCallbackQuery", { callback_query_id: q.id }); } catch (_) {}
  }
}

async function handleUpdate(u) {
  try {
    if (u.message) await onMessage(u.message);
    else if (u.callback_query) await onCallback(u.callback_query);
  } catch (e) { log("upd " + e.message); }
}

/* ---------- Эстафета (self-dispatch) ---------- */
async function dispatchReplacement() {
  const gt = process.env.GITHUB_TOKEN;
  if (!gt || MEMORY_MODE) return;
  try {
    const r = await fetch(`${GH_API}/repos/${GH_REPO}/actions/workflows/bot.yml/dispatches`, {
      method: "POST",
      headers: { "Authorization": `token ${gt}`, "Accept": "application/vnd.github+json", "User-Agent": "mafia-uz" },
      body: JSON.stringify({ ref: "main" }),
    });
    log("replacement dispatched:", r.status);
  } catch (e) { log("dispatch err: " + e.message); }
}

/* ---------- Main loop ---------- */
async function main() {
  if (!TOKEN) { console.error("Нет MAFIA_BOT_TOKEN"); return; }
  log("Mafia UZ bot запущен");
  await loadAll();
  let offset = 0;
  const t0 = Date.now();
  const tickTimer = setInterval(() => tick().catch(e => log("tick " + e.message)), 5000);
  setTimeout(() => dispatchReplacement(), RUN_MS - 35_000);

  while (Date.now() - t0 < RUN_MS) {
    try {
      const r = await fetch(`${API("getUpdates")}?timeout=25&offset=${offset}&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`, {
        headers: { "Content-Type": "application/json" },
      });
      const j = await r.json();
      if (!j.ok) { if (j.error_code === 409) { await new Promise(rr => setTimeout(rr, 2000)); continue; } log("getUpdates: " + j.description); break; }
      for (const u of j.result) { offset = Math.max(offset, u.update_id + 1); await handleUpdate(u); }
    } catch (e) { log("loop: " + e.message); await new Promise(rr => setTimeout(rr, 3000)); }
  }
  clearInterval(tickTimer);
  log("завершение смены");
}

if (IS_MAIN) main();
module.exports = { handleUpdate, tick, MEM, putGame, gameOf, createLobby, startGame, beginNight, beginVote, resolveNight, resolveVote, checkWin, t, tg, MEMORY_MODE, loadAll, distributeRoles };
