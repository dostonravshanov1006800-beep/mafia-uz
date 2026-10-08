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
const BANNER = "https://raw.githubusercontent.com/" + GH_REPO + "/main/assets/banner.jpg";
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
  btnJoin:      { ru: "🎭 Вступить в семью", uz: "🎭 Qoʻshilish" },
  btnLeave:     { ru: "🚪 Покинуть", uz: "🚪 Chiqib ketish" },
  btnStart:     { ru: "🎩 Начать игру", uz: "🎩 Oʻyinni boshlash" },
  btnCancel:    { ru: "🚫 Отменить", uz: "🚫 Bekor qilish" },
  btnAgain:     { ru: "🎲 Играть снова", uz: "🎲 Yana oʻynash" },
  noCreator:    { ru: "Это может только создатель игры.", uz: "Buni faqat oʻyin yaratuvchisi qilishi mumkin." },
  started:      { ru: "🎭 Игра началась! Роли отправлены в личные сообщения. Проверьте личку — если её нет, нажмите /start у бота.", uz: "🎭 Oʻyin boshlandi! Rollar shaxsiy chatga yuborildi. Chatni tekshiring — xabar kelmasa botga /start yozing." },
  nightTitle:   { ru: "🌙 НОЧЬ {n}. Город засыпает...", uz: "🌙 TUN {n}. Shahar uxlay boshlaydi..." },
  nightWait:    { ru: "⏳ Мафия выбирает жертву, доктор готовит скальпель, комиссар идёт по следу...", uz: "⏳ Mafiya qurbon tanlamoqda, doktor davolashga tayyorlanmoqda, komissar iz qidirmoqda..." },
  nightLeft:    { ru: "осталось {s} сек", uz: "{s} sekund qoldi" },
  yourRole:     { ru: "🎭 Ваша роль: <b>{role}</b>\n\n{desc}", uz: "🎭 Rolingiz: <b>{role}</b>\n\n{desc}" },
  nightMafia:   { ru: "🔪 Вы — мафия. Выберите жертву:", uz: "🔪 Siz — mafiya. Qurbonni tanlang:" },
  nightDoctor:  { ru: "💊 Вы — доктор. Кого лечить этой ночью?", uz: "💊 Siz — doktor. Bu tunda kimga yordam berasiz?" },
  nightSheriff: { ru: "🕵️ Вы — комиссар. Кого проверить?", uz: "🕵️ Siz — komissar. Kimni tekshirish?" },
  chooseTarget:  { ru: "Выберите игрока:", uz: "Oʻyinchini tanlang:" },
  passNight:    { ru: "😴 Тихая ночь", uz: "😴 Tun tinch oʻtsin" },
  actDone:      { ru: "✅ Принято.", uz: "✅ Qabul qilindi." },
  dayTitle:     { ru: "☀️ ДЕНЬ {n}. Город просыпается!", uz: "☀️ KUN {n}. Shahar uygʻonadi!" },
  diedNight:    { ru: "☠️ Убит этой ночью: <b>{name}</b> — был(а) {role}.", uz: "☠️ Bu tun qurboni: <b>{name}</b> — {role} edi." },
  savedNight:   { ru: "💊 Ночью было покушение, но доктор спас жертву! Никто не погиб.", uz: "💊 Tunda hujum boʻldi, ammo doktor qurbonni qutqardi! Hech kim halok boʻlmadi." },
  noKill:       { ru: "😴 Ночь прошла спокойно. Никто не погиб.", uz: "😴 Tun tinch oʻtdi. Hech kim halok boʻlmadi." },
  discuss:      { ru: "🗣 Обсуждение! Кто мафия? У вас {s} секунд.", uz: "🗣 Munozara! Kim mafiya? Sizda {s} sekund bor." },
  voteAsk:      { ru: "⚖️ Голосование! Кого казнить?", uz: "⚖️ Ovoz berish! Kimni shahardan chiqaramiz?" },
  votePM:       { ru: "⚖️ Голосуйте, кого казнить сегодня:", uz: "⚖️ Bugun kimni shahardan chiqaramiz? Ovozingizni bering:" },
  passVote:     { ru: "🤷 Воздержаться", uz: "🤷 Ovoz bermaslik" },
  voteLeft:     { ru: "Голосов: {c}/{t}. Осталось {s} сек.", uz: "Ovozlar: {c}/{t}. {s} sekund qoldi." },
  lynched:      { ru: "☠️ Город решил: <b>{name}</b> казнён — был(а) {role}.", uz: "☠️ Shahar qarori: <b>{name}</b> shahardan chiqarildi — {role} edi." },
  noLynch:      { ru: "🤷 Город не смог решить. Никого не казнили.", uz: "🤷 Shahar qaror qila olmadi. Hech kim shahardan chiqarilmadi." },
  winMafia:     { ru: "🏆 МАФИЯ ПОБЕДИЛА!", uz: "🏆 MAFIYA GʻALABA QILDI!" },
  winCiv:       { ru: "🏆 МИРНЫЕ ПОБЕДИЛИ! Вся мафия уничтожена.", uz: "🏆 TINCH AHLI GʻALABA QILDI! Butun mafiya yoʻq qilindi." },
  rolesWere:    { ru: "🎭 Роли:", uz: "🎭 Rollar:" },
  gameCancelled: { ru: "❌ Игра отменена.", uz: "❌ Oʻyin bekor qilindi." },
  helpGroup:    { ru: "👉 Добавьте меня в группу и нажмите «Новая игра».", uz: "👉 Meni guruhga qoʻshing va «Yangi oʻyin»ni bosing." },
  helpPM:       { ru: "👋 Я — <b>Mafia UZ</b>, игровая Мафия в Telegram.\n\nСоберите друзей в группе (от 4 игроков, без лимита) — и я стану ведущим: раздам роли, буду вести ночи и дни, голосование и таймеры.\n\n👉 Добавьте меня в группу и напишите /start (или нажмите кнопку ниже).\n\nЯ говорю на 🇷🇺 и 🇺🇿.", uz: "👋 Men — <b>Mafia UZ</b>, Telegramdagi Mafiya oʻyini.\n\nGuruhga 4 tadan doʻstni yigʻing — chegara yoʻq. Men oʻyin boshlovchisi boʻlaman: rollarni tarqataman, tun va kunni, ovoz berish va taymerlarni oʻzim olib boraman.\n\n👉 Meni guruhga qoʻshing va /start yozing.\n\nMen 🇺🇿 va 🇷🇺 tillarida gaplashaman." },
  newGame:      { ru: "🎲 Новая игра", uz: "🎲 Yangi oʻyin" },
  pmBlocked:    { ru: "⚠️ {name}, откройте личку с ботом (напишите мне /start), иначе не сможете играть.", uz: "⚠️ {name}, botga shaxsiy chatni oching (menga /start yozing), aks holda oʻynay olmaysiz." },
  tooFew:       { ru: "❌ Нужно минимум 4 игрока.", uz: "❌ Kamida 4 oʻyinchi kerak." },
  notInGame:    { ru: "Вы не в игре.", uz: "Siz oʻyinda emassiz." },
  deadNoAct:    { ru: "💀 Мёртвые молчат 😏", uz: "💀 Oʻliklar jim turadi 😏" },
  alreadyVoted: { ru: "Голос уже учтён.", uz: "Ovoz allaqachon qabul qilindi." },
  sheriffMafia: { ru: "🚨 <b>Это МАФИЯ!</b>", uz: "🚨 <b>Bu MAFIYA!</b>" },
  sheriffCiv:   { ru: "😌 Не мафия.", uz: "😌 Mafiya emas." },
  cantVoteSelf: { ru: "За себя голосовать нельзя.", uz: "Oʻzingizga ovoz berib boʻlmaydi." },
  gameExists:   { ru: "Здесь уже идёт игра или набор.", uz: "Bu yerda oʻyin allaqachon davom etmoqda." },
  langSet:     { ru: "🇷🇺 Русский", uz: "🇺🇿 Oʻzbek" },
  noAdmin:     { ru: "⛔ Это могут только админы группы.", uz: "⛔ Buni faqat guruh adminlari qilishi mumkin." },
  lobbyAdmin:  { ru: "⚙️ Старт, отмена, 🗑 кик и язык — только для админов группы.", uz: "⚙️ Start, bekor qilish, 🗑 chiqarish va til — faqat guruh adminlari uchun." },
  kicked:      { ru: "🗑 {name} исключён из набора администратором.", uz: "🗑 {name} admin tomonidan oʻyindan chiqarildi." },
  adminOnlyCmd:{ ru: "Команда только для админов группы.", uz: "Buyruq faqat guruh adminlari uchun." },
  skipped:     { ru: "⏩ Фаза пропущена админом.", uz: "⏩ Faza admin tomonidan oʻtkazildi." },
};

/* Роли */
const ROLES = {
  don:     { ru: "🎯 Дон Мафии", uz: "🎯 Mafiya Doni",
             ruD: "Ночью выбираете жертву. Днём скрывайтесь среди мирных.", uzD: "Tunda qurbonni tanlaysiz. Kunduzi tinchlar orasida yashirining." },
  mafia:   { ru: "🔪 Мафия", uz: "🔪 Mafiya",
             ruD: "Ночью выбираете жертву. Днём скрывайтесь среди мирных.", uzD: "Tunda qurbonni tanlaysiz. Kunduzi tinchlar orasida yashirining." },
  sheriff: { ru: "🕵️ Комиссар", uz: "🕵️ Komissar",
             ruD: "Каждую ночь проверяете одного игрока: мафия он или нет.", uzD: "Har tunda bitta oʻyinchini tekshirasiz: mafiya yoki yoʻq." },
  doctor:  { ru: "💊 Доктор", uz: "💊 Doktor",
             ruD: "Каждую ночь спасаете одного игрока (можно себя) от мафии.", uzD: "Har tunda bittadan oʻyinchini tanlab, uni mafiyadan qutqarasiz (oʻzingizni ham tanlash mumkin)." },
  civ:     { ru: "👤 Мирный житель", uz: "👤 Tinch aholi",
             ruD: "Днём ищите мафию и голосуйте. Ночью — спите и верьте в доктора.", uzD: "Kunduzi mafiyani qidiring va ovoz bering. Tunda uxlang — doktorga ishoning." },
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


/* ---------- Тексты профилей (RU/UZ) ---------- */
const P = {
  cardTitle:   { ru: "👤 Ваш профиль", uz: "👤 Sizning profilingiz" },
  lvl:         { ru: "Уровень: {v}", uz: "Sath: {v}" },
  xpLine:      { ru: "XP: {v}", uz: "XP: {v}" },
  rating:      { ru: "⭐ Рейтинг: {v}", uz: "⭐ Reyting: {v}" },
  coins:       { ru: "🪙 Монеты: {v}", uz: "🪙 Tanga: {v}" },
  gamesLine:   { ru: "🎮 Игры: {g} · ✅ {w} · ❌ {l}", uz: "🎮 Oʻyinlar: {g} · ✅ {w} · ❌ {l}" },
  streakLine:  { ru: "🔥 Серия побед: {v} (рекорд {r})", uz: "🔥 Gʻalaba seriyasi: {v} (rekord {r})" },
  achLine:     { ru: "🏅 Достижения: {v}/{t}", uz: "🏅 Yutuqlar: {v}/{t}" },
  kbBonus:     { ru: "🎁 Бонус", uz: "🎁 Kunlik bonus" },
  kbTop:       { ru: "🏆 Топ", uz: "🏆 Reyting" },
  kbLang:      { ru: "🇺🇿 Перейти на узбекский", uz: "🇷🇺 Rus tiliga oʻtish" },
  bonusGot:    { ru: "🎁 Бонус получен: +{v} 🪙!\n🔥 Серия дней: {s}\n\nПриходите завтра!", uz: "🎁 Bonus olindi: +{v} 🪙!\n🔥 Kunlar seriyasi: {s}\n\nErtaga yana keling!" },
  bonusOld:    { ru: "⏳ Бонус уже получен. Возвращайтесь завтра!", uz: "⏳ Bugungi bonus olingan. Ertaga yana keling!" },
  topTitle:    { ru: "🏆 ТОП-10 по рейтингу", uz: "🏆 Reyting boʻyicha TOP-10" },
  topEmpty:    { ru: "Хм, рейтинг пока пуст. Сыграйте первыми!", uz: "Reyting hali boʻsh. Birinchi boʻlib oʻynang!" },
  winYou:      { ru: "🏆 <b>Галаба!</b> +{xp} XP · +{c} 🪙 · рейтинг {r}", uz: "🏆 <b>Gʻalaba!</b> +{xp} XP · +{c} 🪙 · reyting {r}" },
  loseYou:     { ru: "💀 <b>Поражение.</b> +{xp} XP · +{c} 🪙 · рейтинг {r}", uz: "💀 <b>Magʻlubiyat.</b> +{xp} XP · +{c} 🪙 · reyting {r}" },
  newAch:      { ru: "🏅 Новое достижение: <b>{v}</b>", uz: "🏅 Yangi yutuq: <b>{v}</b>" },
  winners:     { ru: "🏆 Победители", uz: "🏆 Gʻoliblar" },
  meShort:     { ru: "👤 {name} · Уровень {lvl} · ⭐ {rating} · 🪙 {coins}", uz: "👤 {name} · Sath {lvl} · ⭐ {rating} · 🪙 {coins}" },
};
function pt(lang, key, vars) {
  let s = (P[key] && (P[key][lang] || P[key].ru)) || key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/* ---------- Профили, уровни, достижения, топ ---------- */
const PROFILES = new Map();
let TOP = [], TOPSHA = null;

const TITLES = [
  { uz: "Yangi oʻyinchi", ru: "Новичок" },
  { uz: "Shahar aholisi", ru: "Горожанин" },
  { uz: "Tajribali aholi", ru: "Опытный горожанин" },
  { uz: "Detektiv", ru: "Детектив" },
  { uz: "Mafiya ovchisi", ru: "Охотник на мафию" },
  { uz: "Shahar afsonasi", ru: "Легенда города" },
  { uz: "Mafiya Doni", ru: "Крёстный отец" },
];
function levelOf(xp) { return Math.floor(Math.sqrt((xp || 0) / 40)) + 1; }
function titleOf(lvl, lang) {
  const i = Math.min(TITLES.length - 1, Math.floor((lvl - 1) / 3));
  return lang === "uz" ? TITLES[i].uz : TITLES[i].ru;
}

const ACHS = [
  { k: "first",    cond: p => p.games >= 1,   uz: "Birinchi oʻyin", ru: "Первая игра", e: "🎮" },
  { k: "firstWin", cond: p => p.wins >= 1,    uz: "Birinchi gʻalaba", ru: "Первая победа", e: "🥇" },
  { k: "w5",       cond: p => p.wins >= 5,     uz: "5 gʻalaba", ru: "5 побед", e: "🏅" },
  { k: "w15",      cond: p => p.wins >= 15,    uz: "15 gʻalaba", ru: "15 побед", e: "🏆" },
  { k: "w30",      cond: p => p.wins >= 30,    uz: "30 gʻalaba", ru: "30 побед", e: "👑" },
  { k: "g10",      cond: p => p.games >= 10,   uz: "10 oʻyin", ru: "10 игр", e: "🎯" },
  { k: "g50",      cond: p => p.games >= 50,   uz: "50 oʻyin", ru: "50 игр", e: "⚔️" },
  { k: "st3",      cond: p => (p.bestStreak || 0) >= 3, uz: "3 ketma-ket gʻalaba", ru: "3 победы подряд", e: "🔥" },
  { k: "st5",      cond: p => (p.bestStreak || 0) >= 5, uz: "5 ketma-ket gʻalaba!", ru: "5 побед подряд!", e: "⚡" },
  { k: "don3",     cond: p => (p.roleWins && p.roleWins.don || 0) >= 3, uz: "Don sifatida 3 gʻalaba", ru: "3 победы Доном", e: "🎯" },
  { k: "doc5",     cond: p => (p.saves || 0) >= 5,  uz: "5 qutqarilgan jon", ru: "5 спасённых жизней", e: "💊" },
  { k: "sher5",    cond: p => (p.checks || 0) >= 5, uz: "5 aniq tekshiruv", ru: "5 точных проверок", e: "🕵️" },
];
function checkAch(p) {
  const have = p.ach || [];
  const fresh = [];
  for (const a of ACHS) {
    if (!have.includes(a.k) && a.cond(p)) { have.push(a.k); fresh.push(a); }
  }
  p.ach = have;
  return fresh;
}

function newProfile(uid, name) {
  return { id: uid, name: name || "", lang: "uz", games: 0, wins: 0, losses: 0, xp: 0,
    rating: 1000, coins: 0, streak: 0, bestStreak: 0, bonusStreak: 0, lastBonus: "",
    ach: [], roleWins: {}, saves: 0, checks: 0, __sha: null, created: Date.now() };
}
async function getProfile(uid, name) {
  if (PROFILES.has(uid)) { const c = PROFILES.get(uid); if (name && !c.name) c.name = name; return c; }
  let p = null;
  if (!MEMORY_MODE) {
    try {
      const cur = await gh(`/repos/${GH_REPO}/contents/profiles/${uid}.json`);
      if (cur) { p = decState(Buffer.from(cur.content, "base64").toString("utf8")); p.__sha = cur.sha; }
    } catch (e) {}
  }
  if (!p) p = newProfile(uid, name);
  PROFILES.set(uid, p);
  return p;
}
async function saveProfile(p) {
  PROFILES.set(p.id, p);
  if (MEMORY_MODE) return;
  try {
    const path = `/repos/${GH_REPO}/contents/profiles/${p.id}.json`;
    const body = { message: `profile ${p.id}`, content: Buffer.from(encState(p)).toString("base64"), ...(p.__sha ? { sha: p.__sha } : {}) };
    const r = await gh(path, { method: "PUT", body: JSON.stringify(body) });
    p.__sha = r.content.sha;
  } catch (e) { log("saveProfile " + e.message); }
}

function todayUZ() { return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); }
function claimBonus(p) {
  const today = todayUZ();
  if (p.lastBonus === today) return { ok: false };
  const yest = new Date(Date.now() + 5 * 3600e3 - 86400e3).toISOString().slice(0, 10);
  p.bonusStreak = (p.lastBonus === yest) ? (p.bonusStreak || 0) + 1 : 1;
  const amount = Math.min(30, 10 + (p.bonusStreak - 1) * 2);
  p.coins += amount; p.lastBonus = today;
  return { ok: true, amount };
}

function cardOf(p, lang) {
  const lvl = levelOf(p.xp);
  return [
    pt(lang, "cardTitle"),
    "",
    `🎭 <b>${esc(p.name || "Oʻyinchi")}</b> — ${titleOf(lvl, lang)}`,
    pt(lang, "lvl", { v: lvl }) + " · " + pt(lang, "xpLine", { v: p.xp || 0 }),
    pt(lang, "rating", { v: p.rating }),
    pt(lang, "coins", { v: p.coins }),
    pt(lang, "gamesLine", { g: p.games, w: p.wins, l: p.losses }),
    pt(lang, "streakLine", { v: p.streak || 0, r: p.bestStreak || 0 }),
    pt(lang, "achLine", { v: (p.ach || []).length, t: ACHS.length }),
  ].join("\n");
}
function pmKb(lang) {
  return { inline_keyboard: [
    [{ text: pt(lang, "kbBonus"), callback_data: "B:bonus" }, { text: pt(lang, "kbTop"), callback_data: "B:top" }],
    [{ text: pt(lang, "kbLang"), callback_data: "B:lang" }],
  ] };
}
function topText(lang) {
  if (!TOP.length) return pt(lang, "topEmpty");
  const lines = TOP.slice(0, 10).map((e, i) =>
    `${["🥇", "🥈", "🥉"][i] || (i + 1) + "."} ${esc(e.name)} — ⭐${e.rating} · ${lang === "uz" ? "Sath" : "Уровень"} ${e.level}${e.wins ? ` · ✅${e.wins}` : ""}`);
  return pt(lang, "topTitle") + "\n\n" + lines.join("\n");
}
async function updateTop(players) {
  const byId = new Map(TOP.map(e => [e.id, e]));
  for (const p of players) {
    const prof = PROFILES.get(p.id);
    if (prof) byId.set(p.id, { id: p.id, name: prof.name || p.name, rating: prof.rating, wins: prof.wins, level: levelOf(prof.xp) });
  }
  const sorted = [...byId.values()].sort((a, b) => b.rating - a.rating).slice(0, 100);
  TOP.length = 0; TOP.push(...sorted); // мутация, чтобы ссылка жила
  if (MEMORY_MODE) return;
  try {
    const body = { message: "top update", content: Buffer.from(encState(TOP)).toString("base64"), ...(TOPSHA ? { sha: TOPSHA } : {}) };
    const r = await gh(`/repos/${GH_REPO}/contents/top.json`, { method: "PUT", body: JSON.stringify(body) });
    TOPSHA = r.content.sha;
  } catch (e) { log("saveTop " + e.message); }
}
async function loadTop() {
  if (MEMORY_MODE) return;
  try {
    const cur = await gh(`/repos/${GH_REPO}/contents/top.json`);
    if (cur) { TOPSHA = cur.sha; const arr = decState(Buffer.from(cur.content, "base64").toString("utf8")); TOP.length = 0; TOP.push(...arr); }
  } catch (e) {}
}
async function sendPmCard(uid, from, cmd) {
  const p = await getProfile(uid, from.first_name || from.username || "");
  if (cmd && cmd.startsWith("/bonus")) {
    const b = claimBonus(p); await saveProfile(p);
    return void (await tg("sendMessage", { chat_id: uid, text: b.ok ? pt(p.lang, "bonusGot", { v: b.amount, s: p.bonusStreak }) : pt(p.lang, "bonusOld"), parse_mode: "HTML", reply_markup: pmKb(p.lang) }).catch(() => {}));
  }
  if (cmd && cmd.startsWith("/top")) {
    return void (await tg("sendMessage", { chat_id: uid, text: topText(p.lang), parse_mode: "HTML", reply_markup: pmKb(p.lang) }).catch(() => {}));
  }
  await tg("sendPhoto", { chat_id: uid, photo: BANNER, caption: "🎩 MAFIA UZ" }).catch(() => {});
  await tg("sendMessage", { chat_id: uid, text: cardOf(p, p.lang) + "\n\n👉 " + t({ lang: p.lang }, "helpGroup"), parse_mode: "HTML", reply_markup: pmKb(p.lang) }).catch(() => {});
}

/* ---------- Игровая логика ---------- */
function numPlayers(g) { return g.players.length; }
async function isAdminUser(g, userId) {
  if (g.creator === userId) return true; // создатель лобби всегда может управлять
  g.adminCache = g.adminCache || {};
  const c = g.adminCache[userId];
  if (c && Date.now() - c.ts < 3600e3) return c.ok;
  try {
    const m = await tg("getChatMember", { chat_id: g.chatId, user_id: userId });
    const ok = ["administrator", "creator"].includes(m && m.status);
    g.adminCache[userId] = { ok, ts: Date.now() };
    return ok;
  } catch (e) { return false; }
}
function alive(g) { return g.players.filter(p => p.alive); }
function aliveCiv(g) { return g.players.filter(p => p.alive && !["don", "mafia"].includes(p.role)); }
function aliveMafia(g) { return g.players.filter(p => p.alive && ["don", "mafia"].includes(p.role)); }
function byNum(g, n) { return g.players.find(p => p.num === n); }
function pName(p) { return esc(p.name || p.username || ("#" + p.num)); }

function distributeRoles(g) {
  // адаптивно под любое число игроков, БЕЗ лимита:
  // мафия ~1/3 (мин. 1, один из них — Дон), 1 доктор на 7, 1 комиссар на 8
  const n = g.players.length;
  const m = Math.max(1, Math.floor(n / 3));
  const dCount = Math.max(1, Math.floor((n - 1) / 7) + 1);
  const sCount = Math.max(1, Math.floor((n - 1) / 8) + 1);
  const ps = [...g.players];
  for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
  ps.forEach((p, i) => {
    if (i === 0) p.role = "don";
    else if (i < m) p.role = "mafia";
    else if (i < m + dCount) p.role = "doctor";
    else if (i < m + dCount + sCount) p.role = "sheriff";
    else p.role = "civ";
    p.alive = true;
  });
  return { mafia: m, doctors: dCount, sheriffs: sCount };
}

function lobbyText(g) {
  const lines = g.players.map(p => `${p.num}. ${pName(p)}${p.id === g.creator ? " 👑" : ""}`).join("\n");
  const need = numPlayers(g) < 4 ? "\n\n" + t(g, "lobbyMin") : "";
  return `${t(g, "lobbyTitle")}\n\n<b>${t(g, "lobbyPlayers")} (${numPlayers(g)}):</b>\n${lines || "—"}${need}\n\n${t(g, "lobbyAdmin")}`;
}
function lobbyKb(g) {
  const kb = [];
  // для всех: вступить / выйти
  kb.push([{ text: t(g, "btnJoin"), callback_data: "j" }, { text: t(g, "btnLeave"), callback_data: "l" }]);
  // только админы (проверка при нажатии): старт, отмена, язык
  kb.push([{ text: t(g, "btnStart"), callback_data: "s" }, { text: t(g, "btnCancel"), callback_data: "x" }, { text: t(g, "langSet"), callback_data: "lang" }]);
  // кик игрока из лобби — только админы (проверка при нажатии)
  if (g.players.length) {
    const row = [];
    for (const p of g.players.slice(0, 20)) {
      row.push({ text: `🗑${p.num}`, callback_data: `k:${p.num}` });
      if (row.length >= 5) { kb.push(row.splice(0)); }
    }
    if (row.length) kb.push(row);
  }
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
    if (["don", "mafia"].includes(p.role)) await pmTargetChoice(g, p, "nightMafia", "n", alive(g).filter(x => !["don","mafia"].includes(x.role)), "🔪");
    else if (p.role === "doctor") await pmTargetChoice(g, p, "nightDoctor", "n", alive(g), "💊");
    else if (p.role === "sheriff") await pmTargetChoice(g, p, "nightSheriff", "n", alive(g).filter(x => x.id !== p.id), "🕵️");
  }
  await putGame(g);
}

async function pmTargetChoice(g, p, introKey, prefix, targets, emo = "⚖️") {
  const kb = { inline_keyboard: [] };
  targets.forEach(x => {
    const last = kb.inline_keyboard[kb.inline_keyboard.length - 1];
    const btn = { text: `${emo} ${x.num} · ${x.name.slice(0, 14)}`, callback_data: `A:${g.chatId}:${prefix}${x.num}` };
    if (!last || last.length >= 3) kb.inline_keyboard.push([btn]); else last.push(btn);
  });
  kb.inline_keyboard.push([{ text: t(g, prefix === "v" ? "passVote" : "passNight"), callback_data: `A:${g.chatId}:p` }]);
  await tg("sendMessage", { chat_id: p.id, text: t(g, introKey) + "\n" + t(g, "chooseTarget"), parse_mode: "HTML", reply_markup: kb }).catch(async (e) => {
    await tg("sendMessage", { chat_id: g.chatId, text: t(g, "pmBlocked", { name: pName(p) }), parse_mode: "HTML" }).catch(() => {});
  });
}

function nightComplete(g) {
  const a = g.phaseData.actions || {};
  const mOK = a.mafia !== undefined || a.mafiaPass || !alive(g).some(x => ["don", "mafia"].includes(x.role));
  const dOK = alive(g).filter(x => x.role === "doctor").every(x => (a.doctors || {})[x.id] !== undefined);
  const sOK = alive(g).filter(x => x.role === "sheriff").every(x => (a.sheriffs || {})[x.id] !== undefined);
  return mOK && dOK && sOK;
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
  const heals = Object.values(a.doctors || {}).filter(v => v !== null && v !== undefined);
  const saved = victim && heals.includes(a.mafia);
  if (victim && saved) {
    for (const [uid, tn] of Object.entries(a.doctors || {})) {
      if (tn === a.mafia) { const dp = g.players.find(x => x.id === +uid); if (dp) dp.saves = (dp.saves || 0) + 1; }
    }
  }
  for (const [uid, tnum] of Object.entries(a.sheriffs || {})) {
    if (tnum === null || tnum === undefined) continue;
    const target = byNum(g, tnum);
    const isMaf = target && ["don", "mafia"].includes(target.role);
    if (isMaf) { const sp = g.players.find(x => x.id === +uid); if (sp) sp.checks = (sp.checks || 0) + 1; }
    await tg("sendMessage", {
      chat_id: +uid,
      text: `<b>${pName(target)}</b> → ${isMaf ? t(g, "sheriffMafia") : t(g, "sheriffCiv")}`,
      parse_mode: "HTML",
    }).catch(() => {});
  }
  let dayText = `${t(g, "dayTitle", { n: g.dayNo })}\n\n`;
  if (victim && saved) {
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
    await pmTargetChoice(g, p, "votePM", "v", alive(g).filter(x => x.id !== p.id), "⚖️");
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
  const isMafiaWin = winner === "mafia";
  const winners = g.players.filter(p => isMafiaWin ? ["don", "mafia"].includes(p.role) : !["don", "mafia"].includes(p.role));
  // --- профильные награды ---
  for (const p of g.players) {
    try {
      const prof = await getProfile(p.id, p.name);
      prof.name = p.name || prof.name;
      prof.lang = g.lang;
      prof.games++;
      const won = winners.some(w => w.id === p.id);
      if (won) { prof.wins++; prof.streak++; prof.bestStreak = Math.max(prof.bestStreak || 0, prof.streak); }
      else { prof.losses++; prof.streak = 0; }
      const oldRating = prof.rating;
      prof.xp += won ? 35 : 12;
      prof.coins += won ? 20 : 5;
      prof.rating = Math.max(100, prof.rating + (won ? 25 + Math.min(10, (prof.streak || 0) * 2) : -15));
      prof.roleWins = prof.roleWins || {};
      if (won) prof.roleWins[p.role] = (prof.roleWins[p.role] || 0) + 1;
      if (p.role === "doctor") prof.saves = (prof.saves || 0) + (p.saves || 0);
      if (p.role === "sheriff") prof.checks = (prof.checks || 0) + (p.checks || 0);
      const fresh = checkAch(prof);
      await saveProfile(prof);
      const dr = prof.rating - oldRating;
      let pm = pt(g.lang, won ? "winYou" : "loseYou", { xp: won ? 35 : 12, c: won ? 20 : 5, r: (dr >= 0 ? "+" : "") + dr + " → " + prof.rating });
      pm += "\n" + cardOf(prof, g.lang);
      for (const a of fresh) pm += "\n\n" + pt(g.lang, "newAch", { v: a.e + " " + (g.lang === "uz" ? a.uz : a.ru) });
      await tg("sendMessage", { chat_id: p.id, text: pm, parse_mode: "HTML" }).catch(() => {});
    } catch (e) { log("reward " + e.message); }
  }
  try { await updateTop(g.players); } catch (e) {}
  const roles = g.players.map(p => `${p.num}. ${pName(p)} — ${roleName(p.role, g.lang)}${p.alive ? " ✅" : " ☠️"}`).join("\n");
  const winnersLine = winners.map(p => pName(p)).join(", ");
  const text = prefix + `<b>${winner === "mafia" ? t(g, "winMafia") : t(g, "winCiv")}</b>\n\n${pt(g.lang, "winners")}: ${winnersLine}\n\n<b>${t(g, "rolesWere")}</b>\n${roles}`;
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
    if (/^\/(start|help|me|profile|bonus|top)/.test(text)) {
      await sendPmCard(chatId, from, text);
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
    await tg("sendPhoto", { chat_id: chatId, photo: BANNER, caption: "🎩 MAFIA UZ — " + t({ lang: "uz" }, "lobbyTitle").replace("🎭 ", "") }).catch(() => {});
    await createLobby(chatId, from);
  } else if (text.startsWith("/top")) {
    const gl = (gameOf(chatId) || {}).lang || "uz";
    await tg("sendMessage", { chat_id: chatId, text: topText(gl), parse_mode: "HTML" }).catch(() => {});
  } else if (text.startsWith("/me") || text.startsWith("/profile")) {
    const gl = (gameOf(chatId) || {}).lang || "uz";
    const p = await getProfile(from.id, from.first_name || from.username || "");
    await tg("sendMessage", { chat_id: chatId, text: cardOf(p, gl), parse_mode: "HTML" }).catch(() => {});
  } else if (text.startsWith("/end") || text.startsWith("/stop")) {
    const g = gameOf(chatId);
    if (g && (await isAdminUser(g, from.id))) {
      g.phase = "ended";
      await tg("sendMessage", { chat_id: chatId, text: t(g, "gameCancelled") }).catch(() => {});
      await putGame(g); MEM.delete(chatId);
    } else if (g) {
      await tg("sendMessage", { chat_id: chatId, text: t(g, "adminOnlyCmd") }).catch(() => {});
    }
  } else if (text.startsWith("/skip")) {
    const g = gameOf(chatId);
    if (!g) return;
    if (!(await isAdminUser(g, from.id))) return void (await tg("sendMessage", { chat_id: chatId, text: t(g, "adminOnlyCmd") }).catch(() => {}));
    if (g.phase === "night" || g.phase === "day" || g.phase === "vote") {
      g.phaseData.deadline = 0;
      await tg("sendMessage", { chat_id: chatId, text: t(g, "skipped") }).catch(() => {});
      await putGame(g);
      await tick();
    }
  }
}

async function onCallback(q) {
  const from = q.from;
  const data = q.data || "";
  const chatId = q.message.chat.id;
  const isGroup = q.message.chat.type !== "private";

  try {
    // ---- кнопки профиля в личке: B:<cmd>
    if (data.startsWith("B:")) {
      const cmd = data.slice(2);
      if (cmd === "lang") {
        const p = await getProfile(from.id, from.first_name || "");
        p.lang = p.lang === "uz" ? "ru" : "uz";
        await saveProfile(p);
        await sendPmCard(from.id, from, "");
        return void (await tg("answerCallbackQuery", { callback_query_id: q.id }));
      }
      await sendPmCard(from.id, from, cmd === "bonus" ? "/bonus" : "/top");
      return void (await tg("answerCallbackQuery", { callback_query_id: q.id }));
    }

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
        if (role === "don") { if (a.mafia === undefined) a.mafia = targetNum; else return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "alreadyVoted") })); }
        if (role === "mafia") { if (a.mafia === undefined) a.mafia = targetNum; else return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "alreadyVoted") })); }
        if (role === "doctor") { (a.doctors = a.doctors || {})[from.id] = targetNum; }
        if (role === "sheriff") { (a.sheriffs = a.sheriffs || {})[from.id] = targetNum; }
        await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "actDone") });
        await putGame(g);
        if (nightComplete(g)) await resolveNight(g);
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
          if (["don", "mafia"].includes(p.role) && a.mafia === undefined) a.mafiaPass = true;
          if (p.role === "doctor") (a.doctors = a.doctors || {})[from.id] = null;
          if (p.role === "sheriff") (a.sheriffs = a.sheriffs || {})[from.id] = null;
          await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "actDone") });
          await putGame(g);
          if (nightComplete(g)) await resolveNight(g);
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
      if (!(await isAdminUser(g, from.id))) return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "noAdmin") }));
      if (numPlayers(g) < 4) return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "tooFew") }));
      await tg("answerCallbackQuery", { callback_query_id: q.id });
      await startGame(g);
    } else if (data === "x") {
      if (!g) return;
      if (!(await isAdminUser(g, from.id))) return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "noAdmin") }));
      g.phase = "ended";
      await tg("sendMessage", { chat_id: chatId, text: t(g, "gameCancelled") }).catch(() => {});
      await putGame(g);
      MEM.delete(chatId);
      await tg("answerCallbackQuery", { callback_query_id: q.id });
    } else if (data === "lang") {
      if (!g || g.phase !== "lobby") return;
      if (!(await isAdminUser(g, from.id))) return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "noAdmin") }));
      g.lang = g.lang === "uz" ? "ru" : "uz";
      await refreshLobby(g);
      await putGame(g);
      await tg("answerCallbackQuery", { callback_query_id: q.id, text: g.lang === "uz" ? "🇺🇿 Oʻzbek" : "🇷🇺 Русский" });
    } else if (data.startsWith("k:")) { // кик из лобби — админ
      if (!g || g.phase !== "lobby") return;
      if (!(await isAdminUser(g, from.id))) return void (await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "noAdmin") }));
      const target = byNum(g, +data.slice(2));
      if (!target) return void (await tg("answerCallbackQuery", { callback_query_id: q.id }));
      g.players = g.players.filter(p => p.id !== target.id);
      g.players.forEach((p, i) => p.num = i + 1);
      await refreshLobby(g);
      await putGame(g);
      await tg("sendMessage", { chat_id: chatId, text: t(g, "kicked", { name: pName(target) }), parse_mode: "HTML" }).catch(() => {});
      await tg("answerCallbackQuery", { callback_query_id: q.id, text: t(g, "actDone") });
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
module.exports = { handleUpdate, tick, MEM, putGame, gameOf, createLobby, startGame, beginNight, beginVote, resolveNight, resolveVote, checkWin, t, tg, MEMORY_MODE, loadAll, distributeRoles, getProfile, claimBonus, PROFILES, TOP, checkAch, cardOf, levelOf, sendPmCard, topText };
