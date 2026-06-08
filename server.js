require('dotenv').config();

const http = require('http');
const { MongoClient } = require('mongodb');

let OpenAI = null;
try {
  const OpenAIModule = require('openai');
  OpenAI = OpenAIModule.default || OpenAIModule;
} catch (e) {
  // OpenAI SDK chỉ cần khi bật AI. Nếu chưa npm install, bot vẫn chạy phần nối chữ thường.
}

const BOT_TOKEN = mustEnv('BOT_TOKEN');
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const BOT_USERNAME = cleanUsername(process.env.BOT_USERNAME || 'thiendaocuuthien_bot');
const GROUP_ID = (process.env.GROUP_ID || '').trim();
const GROUP_USERNAME = cleanUsername(process.env.GROUP_USERNAME || 'cuuthien_group');
const ADMIN_IDS = new Set((process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const DEFAULT_TURN_SECONDS = intEnv('DEFAULT_TURN_SECONDS', 45);
const MIN_SYLLABLES = intEnv('MIN_SYLLABLES', 2);
const MAX_SYLLABLES = intEnv('MAX_SYLLABLES', 6);
const MAX_MISSES = intEnv('MAX_MISSES', 2);
const NORMAL_TEXT_MODE = String(process.env.NORMAL_TEXT_MODE || 'true').toLowerCase() === 'true';
const PORT = intEnv('PORT', 3000);
const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
const MONGODB_DB = (process.env.MONGODB_DB || 'cuuthien_noi_chu').trim();
const MONGODB_REQUIRED = String(process.env.MONGODB_REQUIRED || 'false').toLowerCase() === 'true';

const RAW_OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_API_KEY = /your_openai_api_key|^sk-your/i.test(RAW_OPENAI_API_KEY) ? '' : RAW_OPENAI_API_KEY;
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-5.5').trim();
const AI_ENABLED = boolEnv('AI_ENABLED', true) && Boolean(OPENAI_API_KEY) && Boolean(OpenAI);
const AI_VALIDATE_MOVES = boolEnv('AI_VALIDATE_MOVES', true);
const AI_HINTS_ENABLED = boolEnv('AI_HINTS_ENABLED', true);
const AI_FREE_CHAT_ENABLED = boolEnv('AI_FREE_CHAT_ENABLED', true);
const AI_MAX_ASK_CHARS = intEnv('AI_MAX_ASK_CHARS', 900);
const AI_TIMEOUT_MS = intEnv('AI_TIMEOUT_MS', 12000);
const AI_COOLDOWN_SECONDS = intEnv('AI_COOLDOWN_SECONDS', 8);
const AI_MIN_REJECT_CONFIDENCE = floatEnv('AI_MIN_REJECT_CONFIDENCE', 0.72);
const BLOCK_REORDERED_WORDS = boolEnv('BLOCK_REORDERED_WORDS', true);
const LOCAL_GARBAGE_FILTER = boolEnv('LOCAL_GARBAGE_FILTER', true);
const AI_STRICT_MEANING = boolEnv('AI_STRICT_MEANING', true);
const BLOCK_FILLER_WORDS = boolEnv('BLOCK_FILLER_WORDS', true);
const BLOCK_DUPLICATE_SYLLABLES = boolEnv('BLOCK_DUPLICATE_SYLLABLES', true);

let mongoClient = null;
let mongoDb = null;
let openaiClient = null;
let pollingOffset = 0;
let shuttingDown = false;

const memory = {
  games: new Map(),
  players: new Map(),
  ledger: []
};

const recentAction = new Map();
const recentAiAction = new Map();

const SUGGESTIONS = {
  hoc: ['học sinh', 'học viện', 'học đường', 'học phí', 'học trò'],
  sinh: ['sinh viên', 'sinh nhật', 'sinh mệnh', 'sinh tồn', 'sinh hoạt'],
  vien: ['viên chức', 'viên mãn', 'viên ngọc', 'viên đạn', 'viên tịch'],
  chuc: ['chức vụ', 'chức năng', 'chức sắc', 'chức quyền', 'chức danh'],
  vu: ['vũ khí', 'vũ trụ', 'vũ điệu', 'vũ công', 'vũ bão'],
  khi: ['khí chất', 'khí hậu', 'khí phách', 'khí công', 'khí thế'],
  chat: ['chất lượng', 'chất vấn', 'chất liệu', 'chất độc', 'chất xám'],
  luong: ['lương tâm', 'lương thực', 'lương thiện', 'lương bổng', 'lương duyên'],
  tam: ['tâm linh', 'tâm sự', 'tâm huyết', 'tâm trạng', 'tâm pháp'],
  linh: ['linh thạch', 'linh khí', 'linh hồn', 'linh thú', 'linh cảm'],
  thach: ['thạch động', 'thạch anh', 'thạch cao', 'thạch sùng', 'thạch trận'],
  dao: ['đạo hữu', 'đạo lý', 'đạo pháp', 'đạo tâm', 'đạo tràng'],
  huu: ['hữu duyên', 'hữu ích', 'hữu nghị', 'hữu tình', 'hữu hạn'],
  duyen: ['duyên phận', 'duyên dáng', 'duyên nợ', 'duyên cớ', 'duyên khởi'],
  phan: ['phận đời', 'phận sự', 'phận người', 'phận bạc', 'phận mỏng'],
  doi: ['đời người', 'đời sống', 'đời thường', 'đời tư', 'đời sau'],
  nguoi: ['người chơi', 'người thân', 'người hùng', 'người đời', 'người bạn'],
  choi: ['chơi game', 'chơi chữ', 'chơi đẹp', 'chơi lớn', 'chơi vui'],
  game: ['game thủ', 'game show', 'game online', 'game mobile', 'game nhập vai'],
  thu: ['thủ lĩnh', 'thủ môn', 'thủ đoạn', 'thủ thuật', 'thủ công'],
  linh2: ['lĩnh vực', 'lĩnh hội', 'lĩnh thưởng', 'lĩnh xướng', 'lĩnh ấn'],
  tien: ['tiên giới', 'tiên nhân', 'tiên đạo', 'tiên duyên', 'tiên pháp'],
  gioi: ['giới hạn', 'giới thiệu', 'giới tính', 'giới luật', 'giới trẻ'],
  han: ['hạn chế', 'hạn hán', 'hạn mức', 'hạn định', 'hạn cuối'],
  che: ['chế độ', 'chế tạo', 'chế biến', 'chế ngự', 'chế phẩm'],
  do: ['độ kiếp', 'độ lượng', 'độ cao', 'độ khó', 'độ bền'],
  kiep: ['kiếp nạn', 'kiếp người', 'kiếp trước', 'kiếp sau', 'kiếp tu'],
  nan: ['nạn nhân', 'nạn đói', 'nạn kiếp', 'nạn dịch', 'nạn lớn'],
  nhan: ['nhân vật', 'nhân duyên', 'nhân nghĩa', 'nhân loại', 'nhân cách'],
  vat: ['vật phẩm', 'vật lý', 'vật chất', 'vật liệu', 'vật nuôi'],
  pham: ['phẩm chất', 'phẩm cấp', 'phẩm giá', 'phẩm hạnh', 'phẩm vị'],
  cap: ['cấp bậc', 'cấp cứu', 'cấp tốc', 'cấp phép', 'cấp trên'],
  bac: ['bậc thầy', 'bạc phận', 'bạc tiền', 'bạc màu', 'bạc hà'],
  thay: ['thầy giáo', 'thầy trò', 'thầy thuốc', 'thầy bói', 'thầy tu'],
  giao: ['giáo viên', 'giáo án', 'giáo dục', 'giáo phái', 'giáo trình'],
  an: ['ân tình', 'ấn ký', 'an toàn', 'an tâm', 'án phạt'],
  tinh: ['tình bạn', 'tình yêu', 'tình huống', 'tình nghĩa', 'tình hình'],
  ban: ['bạn bè', 'bản lĩnh', 'bản đồ', 'bàn luận', 'ban thưởng'],
  be: ['bè bạn', 'bẻ khóa', 'bé nhỏ', 'bê tông', 'bế quan'],
  quan: ['quan sát', 'quan trọng', 'quan hệ', 'quan tâm', 'quan tài'],
  sat: ['sát thương', 'sát nhập', 'sát khí', 'sát thủ', 'sát cánh'],
  thuong: ['thương mại', 'thương hiệu', 'thương tâm', 'thương lượng', 'thương nhân'],
  mai: ['mại dâm', 'mai sau', 'mai mối', 'mai táng', 'mai phục'],
  sau: ['sau này', 'sau lưng', 'sau cùng', 'sau đó', 'sâu sắc'],
  nay: ['này nọ', 'nay mai', 'nảy mầm', 'nây người', 'này nhé']
};

function mustEnv(name) {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(`Thiếu biến môi trường ${name}`);
  return value;
}

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function floatEnv(name, fallback) {
  const value = Number.parseFloat(process.env[name] || '');
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'bat', 'bật'].includes(String(raw).trim().toLowerCase());
}

function cleanUsername(v) {
  return String(v || '').trim().replace(/^@/, '').toLowerCase();
}

function html(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mention(user) {
  const name = user.first_name || user.username || String(user.id);
  return `<a href="tg://user?id=${user.id}">${html(name)}</a>`;
}

function normalizeVietnamese(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactKey(s) {
  return normalizeVietnamese(s).replace(/[^a-zA-ZđĐ\s]/g, '').replace(/\s+/g, ' ').trim();
}

function tokenizePhrase(raw) {
  const cleaned = String(raw || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[@#]\S+/g, ' ')
    .replace(/[.,!?;:()\[\]{}"“”'`~|\\/<>+=*_–—-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.split(' ') : [];
}

function parseCandidate(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, reason: 'Bạn chưa nhập cụm từ.' };
  if (/https?:\/\//i.test(text)) return { ok: false, reason: 'Không dùng link trong từ nối.' };
  if (/\d/.test(text)) return { ok: false, reason: 'Không dùng số trong từ nối.' };
  const syllables = tokenizePhrase(text);
  if (syllables.length < MIN_SYLLABLES) return { ok: false, reason: `Cụm từ phải có ít nhất ${MIN_SYLLABLES} tiếng.` };
  if (syllables.length > MAX_SYLLABLES) return { ok: false, reason: `Cụm từ tối đa ${MAX_SYLLABLES} tiếng để tránh spam.` };
  const phrase = syllables.join(' ');
  if (!/^[a-zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ\s]+$/i.test(phrase)) {
    return { ok: false, reason: 'Cụm từ có ký tự lạ.' };
  }
  return {
    ok: true,
    phrase,
    syllables,
    first: syllables[0],
    last: syllables[syllables.length - 1],
    key: compactKey(phrase),
    firstKey: compactKey(syllables[0]),
    lastKey: compactKey(syllables[syllables.length - 1])
  };
}


function phraseSignatureFromSyllables(syllables) {
  return (syllables || [])
    .map(x => compactKey(x))
    .filter(Boolean)
    .sort()
    .join('|');
}

function findReorderedPhraseConflict(game, parsed) {
  if (!BLOCK_REORDERED_WORDS || !parsed?.syllables || parsed.syllables.length < 2) return null;
  ensureGameDefaults(game);
  const signature = phraseSignatureFromSyllables(parsed.syllables);
  if (!signature) return null;

  for (const item of Object.values(game.usedWords || {})) {
    const oldWord = item?.word || '';
    const oldParsed = parseCandidate(oldWord);
    if (!oldParsed.ok) continue;
    if (oldParsed.key === parsed.key) continue;
    if (oldParsed.syllables.length !== parsed.syllables.length) continue;
    if (phraseSignatureFromSyllables(oldParsed.syllables) === signature) {
      return oldParsed.phrase;
    }
  }
  return null;
}

function localMeaningReject(parsed) {
  if (!LOCAL_GARBAGE_FILTER || !parsed?.syllables) return '';
  const keys = parsed.syllables.map(x => compactKey(x));

  const fillerWords = new Set([
    'gi', 'nao', 'sao', 'a', 'ha', 'hoi', 'nhi', 'nha', 'nhe', 'nho',
    'khong', 'ko', 'k', 'hong', 'chu', 'vay', 'the', 'co', 'ma', 'di',
    'haha', 'hihi', 'hehe', 'lol', 'ok', 'oke', 'uh', 'um', 'u', 'o'
  ].map(compactKey));
  const weakTailWords = new Set([
    'gi', 'nao', 'sao', 'a', 'ha', 'hoi', 'nhi', 'nha', 'nhe', 'nho',
    'khong', 'ko', 'k', 'hong', 'chu', 'vay', 'the', 'co', 'ma', 'di'
  ].map(compactKey));

  for (const key of keys) {
    if (!key) return 'Có tiếng rỗng hoặc ký tự không hợp lệ.';
    if (/([a-z])\1\1/i.test(key)) return 'Có tiếng bị kéo dài ký tự bất thường, giống spam.';
    if (key.length >= 2 && !/[aeiouy]/i.test(key)) return `Tiếng “${key}” không giống âm tiết tiếng Việt có nghĩa.`;
    if (BLOCK_FILLER_WORDS && fillerWords.has(key)) {
      return `Không nhận tiếng đệm/câu hỏi “${key}”. Cụm nối phải là từ hoặc cụm từ có nghĩa, không phải câu hỏi nói miệng.`;
    }
  }

  if (BLOCK_DUPLICATE_SYLLABLES) {
    for (let i = 1; i < keys.length; i++) {
      if (keys[i] === keys[i - 1]) return 'Không nhận kiểu lặp tiếng như “gì gì”, “nổ nổ”.';
    }
  }

  if (BLOCK_FILLER_WORDS && weakTailWords.has(keys[keys.length - 1])) {
    return 'Không nhận cụm kết thúc bằng tiếng hỏi/đệm như “gì”, “à”, “hả”, “không”.';
  }

  const joined = keys.join('');
  if (/^(asdf|qwer|zxcv|aaaa|bbbb|cccc|dddd|kkkk|mmmm|xxxx|zzzz)/i.test(joined)) {
    return 'Cụm này giống gõ bừa bàn phím, không được tính.';
  }

  return '';
}

function now() {
  return Date.now();
}

function secondsLeft(deadline) {
  return Math.max(0, Math.ceil((deadline - now()) / 1000));
}

function userKey(chatId, userId) {
  return `${chatId}:${userId}`;
}

async function telegram(method, payload = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const desc = data.description || `HTTP ${res.status}`;
    throw new Error(`${method} failed: ${desc}`);
  }
  return data.result;
}

async function sendMessage(chatId, text, extra = {}) {
  try {
    return await telegram('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra
    });
  } catch (e) {
    console.error('sendMessage error:', e.message);
  }
}

async function answer(chatId, text, replyToMessageId) {
  return sendMessage(chatId, text, replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {});
}

async function initDb() {
  if (!MONGODB_URI) {
    console.log('MongoDB chưa cấu hình. Bot sẽ chạy bộ nhớ tạm.');
    return;
  }

  if (MONGODB_URI.includes('<db_password>') || MONGODB_URI.includes('PASTE_DB_PASSWORD_HERE')) {
    const msg = 'MONGODB_URI vẫn còn placeholder mật khẩu. Hãy thay <db_password> bằng mật khẩu MongoDB thật.';
    if (MONGODB_REQUIRED) throw new Error(msg);
    console.warn(msg + ' Bot tạm chạy bằng RAM, restart sẽ mất dữ liệu.');
    return;
  }

  try {
    mongoClient = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
      socketTimeoutMS: 30000
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db(MONGODB_DB);
    await mongoDb.collection('games').createIndex({ chatId: 1 }, { unique: true });
    await mongoDb.collection('players').createIndex({ chatId: 1, userId: 1 }, { unique: true });
    await mongoDb.collection('players').createIndex({ chatId: 1, score: -1, wins: -1 });
    await mongoDb.collection('ledger').createIndex({ chatId: 1, createdAt: -1 });
    console.log('MongoDB connected:', MONGODB_DB);
  } catch (e) {
    mongoClient = null;
    mongoDb = null;
    console.error('MongoDB connect failed:', e.message);
    console.error('Bot sẽ tiếp tục chạy bằng RAM. Lưu ý: restart/deploy lại sẽ mất điểm và ván đang chơi.');
    console.error('Cần kiểm tra MONGODB_URI, mật khẩu đã URL-encode, Network Access/IP allowlist trong MongoDB Atlas.');
    if (MONGODB_REQUIRED) throw e;
  }
}

async function loadGame(chatId) {
  const id = String(chatId);
  if (mongoDb) return await mongoDb.collection('games').findOne({ chatId: id });
  return memory.games.get(id) || null;
}

async function saveGame(game) {
  game.chatId = String(game.chatId);
  game.updatedAt = new Date();
  if (mongoDb) {
    await mongoDb.collection('games').updateOne({ chatId: game.chatId }, { $set: game }, { upsert: true });
  } else {
    memory.games.set(game.chatId, structuredCloneSafe(game));
  }
}

async function deleteGame(chatId) {
  const id = String(chatId);
  if (mongoDb) await mongoDb.collection('games').deleteOne({ chatId: id });
  else memory.games.delete(id);
}

async function logEvent(chatId, type, data = {}) {
  const row = { chatId: String(chatId), type, data, createdAt: new Date() };
  if (mongoDb) await mongoDb.collection('ledger').insertOne(row);
  else memory.ledger.push(row);
}

function initOpenAI() {
  if (!OPENAI_API_KEY) {
    console.log('OPENAI_API_KEY chưa cấu hình. AI sẽ tắt, game vẫn chạy bình thường.');
    return;
  }
  if (!OpenAI) {
    console.log('Chưa cài package openai. Chạy npm install rồi khởi động lại nếu muốn bật AI.');
    return;
  }
  if (!AI_ENABLED) {
    console.log('AI_ENABLED=false. AI đang tắt.');
    return;
  }
  openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  console.log(`AI connected: ${OPENAI_MODEL}`);
}

function aiReady() {
  return AI_ENABLED && Boolean(openaiClient);
}

function safeJsonParse(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function cleanAiText(text, max = 3800) {
  return String(text || '')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim()
    .slice(0, max);
}

async function aiText(instructions, input, maxOutputTokens = 500) {
  if (!aiReady()) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await openaiClient.responses.create({
      model: OPENAI_MODEL,
      instructions,
      input,
      max_output_tokens: maxOutputTokens
    }, { signal: controller.signal });
    return cleanAiText(response.output_text || '', 6000);
  } catch (e) {
    console.error('OpenAI error:', e.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function aiCooldownLeft(chatId, userId) {
  const key = `${chatId}:${userId}`;
  const last = recentAiAction.get(key) || 0;
  const left = AI_COOLDOWN_SECONDS - Math.floor((now() - last) / 1000);
  return Math.max(0, left);
}

function markAiUsed(chatId, userId) {
  recentAiAction.set(`${chatId}:${userId}`, now());
}

async function aiValidateMove(parsed, game) {
  if (!aiReady()) return null;
  const lastWords = (game.moveHistory || []).slice(-8).map(x => x.word).join(' → ') || 'chưa có';
  const instructions = `Bạn là trọng tài game nối chữ tiếng Việt trong group Telegram.
Chỉ trả về JSON hợp lệ, không markdown.
Nhiệm vụ: đánh giá cụm người chơi vừa nhập có phải cụm tiếng Việt có nghĩa, tự nhiên, không phải chuỗi âm vô nghĩa, không phải spam, không phải xúc phạm hay nội dung nguy hiểm.
Không cần kiểm tra chữ nối vì server đã kiểm tra. Có thể chấp nhận từ Hán Việt, từ game/tu tiên, thuật ngữ phổ biến, tiếng lóng Việt Nam nếu có nghĩa thật và dùng tự nhiên.
Phải chấm rất nghiêm: cụm ghép máy móc, đảo chữ cho có như chỉ hoán vị tiếng của một cụm cũ, hoặc cụm nghe giống Hán Việt nhưng không có nghĩa tự nhiên thì valid=false. Tuyệt đối không nhận dạng câu hỏi/câu nói đùa/cụm đệm như 'nổ gì', 'gì gì', 'đạo hả', 'tiên không', 'kiếm à'. Cụm được duyệt phải là từ ghép/cụm danh từ/cụm động từ/cụm tính từ có nghĩa thật và dùng tự nhiên. Nếu không chắc cụm có nghĩa, hãy valid=false với confidence khoảng 0.8 và nêu lý do ngắn.
JSON dạng: {"valid":true|false,"confidence":0..1,"reason":"lý do ngắn","suggestion":"gợi ý sửa nếu sai"}`;
  const input = `Cụm cần xét: ${parsed.phrase}
Chữ bắt buộc đầu lượt: ${game.required || '(tự do)'}
Cụm trước: ${game.currentWord || '(chưa có)'}
Các cụm gần đây: ${lastWords}
Lưu ý luật rất nghiêm: không nhận cụm vô nghĩa, gượng ép, câu hỏi nói miệng, tiếng đệm như 'gì/à/hả/không', lặp tiếng kiểu 'gì gì', hoặc đảo thứ tự tiếng từ cụm đã dùng.`;
  const text = await aiText(instructions, input, 220);
  const data = safeJsonParse(text);
  if (!data || typeof data.valid !== 'boolean') return null;
  data.confidence = Number.isFinite(Number(data.confidence)) ? Math.max(0, Math.min(1, Number(data.confidence))) : 0.5;
  data.reason = cleanAiText(data.reason || '', 300);
  data.suggestion = cleanAiText(data.suggestion || '', 160);
  return data;
}

async function aiSuggestWords(required, usedWords = {}) {
  if (!aiReady() || !AI_HINTS_ENABLED || !required) return [];
  const used = Object.values(usedWords || {}).map(x => x.word).filter(Boolean).slice(-80).join(', ');
  const instructions = `Bạn là trợ lý game nối chữ tiếng Việt.
Chỉ trả về JSON hợp lệ, không markdown.
Tạo 5 đến 8 cụm tiếng Việt có nghĩa, tự nhiên, bắt đầu đúng bằng tiếng được yêu cầu. Mỗi cụm dài 2-5 tiếng, không trùng danh sách đã dùng, không đảo thứ tự tiếng của cụm đã dùng, ưu tiên cụm vui/tu tiên nhưng vẫn có nghĩa.
JSON dạng: {"suggestions":["cụm 1","cụm 2"]}`;
  const text = await aiText(instructions, `Tiếng bắt buộc: ${required}
Đã dùng: ${used || '(không có)'}`, 260);
  const data = safeJsonParse(text);
  const arr = Array.isArray(data?.suggestions) ? data.suggestions : [];
  const requiredKey = compactKey(required);
  const out = [];
  for (const w of arr) {
    const parsed = parseCandidate(w);
    if (!parsed.ok) continue;
    if (parsed.firstKey !== requiredKey) continue;
    if (usedWords[parsed.key]) continue;
    if (findReorderedPhraseConflict({ usedWords }, parsed)) continue;
    if (localMeaningReject(parsed)) continue;
    if (!out.some(x => compactKey(x) === parsed.key)) out.push(parsed.phrase);
  }
  return out.slice(0, 8);
}

async function aiAsk(question, game, user) {
  if (!aiReady() || !AI_FREE_CHAT_ENABLED) return null;
  const status = game?.status || 'không có ván';
  const current = game?.currentWord || 'chưa có';
  const required = game?.required || 'tự do';
  const alive = game?.players ? alivePlayers(ensureGameDefaults(game)).length : 0;
  const instructions = `Bạn là Thiên Đạo Cửu Thiên, trợ lý AI của bot Telegram game nối chữ.
Trả lời bằng tiếng Việt, ngắn gọn, vui kiểu tu tiên nhưng rõ ràng. Hỗ trợ luật game, gợi ý chiến thuật, giải thích vì sao từ đúng/sai.
Giữ an toàn, không hướng dẫn hành vi nguy hiểm, không nội dung người lớn, không chửi tục nặng. Nếu không chắc nghĩa của một cụm từ, nói là không chắc.`;
  const input = `Người hỏi: ${user.first_name || user.username || user.id}
Trạng thái ván: ${status}
Cụm hiện tại: ${current}
Tiếng cần nối: ${required}
Số người còn sống: ${alive}
Câu hỏi: ${question}`;
  return await aiText(instructions, input, 650);
}

async function aiJudgePhrase(raw, game) {
  if (!aiReady()) return null;
  const parsed = parseCandidate(raw);
  if (!parsed.ok) return { valid: false, confidence: 1, reason: parsed.reason, suggestion: '' };
  return await aiValidateMove(parsed, ensureGameDefaults(game || {}));
}

async function upsertPlayer(chatId, user) {
  const id = userKey(chatId, user.id);
  const base = {
    chatId: String(chatId),
    userId: String(user.id),
    username: user.username || '',
    firstName: user.first_name || '',
    lastName: user.last_name || '',
    updatedAt: new Date()
  };
  if (mongoDb) {
    await mongoDb.collection('players').updateOne(
      { chatId: String(chatId), userId: String(user.id) },
      { $set: base, $setOnInsert: { score: 0, wins: 0, games: 0, misses: 0, createdAt: new Date() } },
      { upsert: true }
    );
  } else {
    const old = memory.players.get(id) || { score: 0, wins: 0, games: 0, misses: 0, createdAt: new Date() };
    memory.players.set(id, { ...old, ...base });
  }
}

async function incPlayer(chatId, userId, inc = {}) {
  const filter = { chatId: String(chatId), userId: String(userId) };
  if (mongoDb) {
    await mongoDb.collection('players').updateOne(filter, { $inc: inc, $set: { updatedAt: new Date() } }, { upsert: true });
  } else {
    const key = userKey(chatId, userId);
    const old = memory.players.get(key) || { chatId: String(chatId), userId: String(userId), score: 0, wins: 0, games: 0, misses: 0 };
    for (const [k, v] of Object.entries(inc)) old[k] = (old[k] || 0) + v;
    old.updatedAt = new Date();
    memory.players.set(key, old);
  }
}

async function getPlayerStats(chatId, userId) {
  if (mongoDb) return await mongoDb.collection('players').findOne({ chatId: String(chatId), userId: String(userId) });
  return memory.players.get(userKey(chatId, userId));
}

async function getLeaderboard(chatId, limit = 10) {
  if (mongoDb) {
    return await mongoDb.collection('players')
      .find({ chatId: String(chatId) })
      .sort({ score: -1, wins: -1, games: 1 })
      .limit(limit)
      .toArray();
  }
  return Array.from(memory.players.values())
    .filter(p => p.chatId === String(chatId))
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.wins || 0) - (a.wins || 0))
    .slice(0, limit);
}

function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function parseCommand(text) {
  const m = String(text || '').trim().match(/^\/([a-zA-Z0-9_]+)(?:@([a-zA-Z0-9_]+))?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const target = cleanUsername(m[2] || '');
  if (target && target !== BOT_USERNAME) return null;
  return { cmd: m[1].toLowerCase(), args: (m[3] || '').trim() };
}

function isAllowedChat(chat) {
  if (!chat) return false;
  if (chat.type === 'private') return true;
  if (GROUP_ID && String(chat.id) !== GROUP_ID) return false;
  if (!GROUP_ID && GROUP_USERNAME && chat.username && cleanUsername(chat.username) !== GROUP_USERNAME) return false;
  return ['group', 'supergroup'].includes(chat.type);
}

async function isAdmin(userId, chatId) {
  if (ADMIN_IDS.has(String(userId))) return true;
  try {
    const member = await telegram('getChatMember', { chat_id: chatId, user_id: userId });
    return ['creator', 'administrator'].includes(member.status);
  } catch {
    return false;
  }
}

function alivePlayers(game) {
  return game.players.filter(p => p.alive !== false);
}

function currentPlayer(game) {
  const alive = alivePlayers(game);
  if (!alive.length) return null;
  if (game.turnIndex >= alive.length) game.turnIndex = 0;
  return alive[game.turnIndex];
}

function nextTurn(game) {
  const alive = alivePlayers(game);
  if (!alive.length) return null;
  game.turnIndex = (game.turnIndex + 1) % alive.length;
  game.turnDeadline = now() + game.secondsPerTurn * 1000;
  return currentPlayer(game);
}

function playerLine(p, index) {
  const name = p.firstName || p.username || p.userId;
  const status = p.alive === false ? '💀' : '🟢';
  return `${index + 1}. ${status} ${html(name)} — ${p.score || 0} điểm, miss ${p.misses || 0}/${MAX_MISSES}`;
}

function ensureGameDefaults(game) {
  game.players ||= [];
  game.usedWords ||= {};
  game.moveHistory ||= [];
  game.turnIndex ||= 0;
  game.secondsPerTurn ||= DEFAULT_TURN_SECONDS;
  return game;
}

async function cmdHelp(chatId) {
  await sendMessage(chatId,
`🎮 <b>Game nối chữ Cửu Thiên</b>

<b>Lệnh chính</b>
/taovan 45 — admin tạo ván, mỗi lượt 45 giây
/dangky — đăng ký tham gia
/danhsach — xem danh sách người chơi
/batdau — admin bắt đầu ván
/noi học sinh — nối chữ
/boqua — xử lý người hết giờ
/ketthuc — admin kết thúc ván
/huytu — admin hủy từ cuối nếu từ sai
/diem — xem điểm cá nhân
/bxh — bảng xếp hạng
/luat — xem luật
/layid — lấy chat id và user id

${NORMAL_TEXT_MODE ? '✅ Bot đang bật chế độ nhận tin nhắn thường khi tới lượt.' : '⚠️ Bot đang chỉ nhận từ qua lệnh /noi.'}`);
}

async function cmdRules(chatId) {
  await sendMessage(chatId,
`📜 <b>Luật nối chữ</b>

1) Người đầu tiên nói cụm bất kỳ từ ${MIN_SYLLABLES}-${MAX_SYLLABLES} tiếng.
2) Người sau phải dùng <b>tiếng cuối</b> của cụm trước làm <b>tiếng đầu</b> của cụm mới.
3) Không được lặp cụm đã dùng trong ván.
4) Không được đảo thứ tự tiếng của cụm đã dùng, ví dụ đã có “kiếm tiên” thì “tiên kiếm” bị chặn.
5) Cụm vô nghĩa, gõ bừa, ghép gượng ép sẽ bị bot/AI từ chối.
6) Mỗi lượt đúng +1 điểm.
7) Quá giờ bị miss. Đủ ${MAX_MISSES} miss sẽ bị loại.
8) Bot so chữ không phân biệt dấu, ví dụ “hữu” và “huu” được xem là cùng tiếng.
9) Nếu từ gây tranh cãi, admin dùng /huytu để hủy từ cuối.
10) Nếu bật AI, bot sẽ dùng AI làm trọng tài phụ để giảm từ rác/vô nghĩa.

Ví dụ: <b>học sinh</b> → <b>sinh viên</b> → <b>viên chức</b> → <b>chức vụ</b>`);
}

async function cmdCreateGame(msg, args) {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id, chatId))) return answer(chatId, '⛔ Chỉ admin group hoặc ADMIN_IDS mới tạo ván.', msg.message_id);
  const seconds = Math.max(10, Math.min(300, Number.parseInt(args, 10) || DEFAULT_TURN_SECONDS));
  const game = {
    chatId: String(chatId),
    status: 'signup',
    secondsPerTurn: seconds,
    createdBy: String(msg.from.id),
    createdAt: new Date(),
    players: [],
    usedWords: {},
    moveHistory: [],
    currentWord: '',
    required: '',
    requiredKey: '',
    turnIndex: 0,
    turnDeadline: 0
  };
  await saveGame(game);
  await logEvent(chatId, 'game_created', { by: msg.from.id, seconds });
  await sendMessage(chatId,
`⚔️ <b>Ván nối chữ mới đã mở!</b>

Người chơi gõ /dangky để tham gia.
Admin gõ /batdau khi đủ người.
⏱️ Mỗi lượt: <b>${seconds}s</b>`);
}

async function cmdJoin(msg) {
  const chatId = msg.chat.id;
  const game = ensureGameDefaults(await loadGame(chatId) || {});
  if (game.status !== 'signup') return answer(chatId, 'Hiện chưa có ván đang mở đăng ký. Admin dùng /taovan để tạo ván.', msg.message_id);
  if (game.players.some(p => p.userId === String(msg.from.id))) return answer(chatId, 'Bạn đã đăng ký rồi.', msg.message_id);
  const p = {
    userId: String(msg.from.id),
    username: msg.from.username || '',
    firstName: msg.from.first_name || '',
    score: 0,
    misses: 0,
    alive: true,
    joinedAt: new Date()
  };
  game.players.push(p);
  await upsertPlayer(chatId, msg.from);
  await saveGame(game);
  await logEvent(chatId, 'player_joined', { userId: msg.from.id });
  await answer(chatId, `✅ ${mention(msg.from)} đã đăng ký. Hiện có <b>${game.players.length}</b> người chơi.`, msg.message_id);
}

async function cmdLeave(msg) {
  const chatId = msg.chat.id;
  const game = ensureGameDefaults(await loadGame(chatId) || {});
  if (!['signup', 'playing'].includes(game.status)) return answer(chatId, 'Không có ván để rời.', msg.message_id);
  const p = game.players.find(x => x.userId === String(msg.from.id));
  if (!p) return answer(chatId, 'Bạn chưa tham gia ván này.', msg.message_id);
  if (game.status === 'signup') game.players = game.players.filter(x => x.userId !== String(msg.from.id));
  else p.alive = false;
  await saveGame(game);
  await answer(chatId, `👋 ${mention(msg.from)} đã rời ván.`, msg.message_id);
}

async function cmdList(chatId) {
  const game = ensureGameDefaults(await loadGame(chatId) || {});
  if (!game.status) return sendMessage(chatId, 'Chưa có ván nào. Admin dùng /taovan để tạo ván.');
  if (!game.players.length) return sendMessage(chatId, 'Chưa có ai đăng ký. Gõ /dangky để vào ván.');
  await sendMessage(chatId,
`👥 <b>Danh sách người chơi</b>
Trạng thái: <b>${html(game.status)}</b>

${game.players.map(playerLine).join('\n')}`);
}

async function cmdStartGame(msg) {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id, chatId))) return answer(chatId, '⛔ Chỉ admin mới bắt đầu ván.', msg.message_id);
  const game = ensureGameDefaults(await loadGame(chatId) || {});
  if (game.status !== 'signup') return answer(chatId, 'Không có ván đang chờ đăng ký. Dùng /taovan trước.', msg.message_id);
  if (game.players.length < 2) return answer(chatId, 'Cần ít nhất 2 người chơi mới bắt đầu được.', msg.message_id);
  for (const p of game.players) {
    p.score = 0;
    p.misses = 0;
    p.alive = true;
    await incPlayer(chatId, p.userId, { games: 1 });
  }
  game.status = 'playing';
  game.turnIndex = 0;
  game.currentWord = '';
  game.required = '';
  game.requiredKey = '';
  game.turnDeadline = now() + game.secondsPerTurn * 1000;
  await saveGame(game);
  await logEvent(chatId, 'game_started', { by: msg.from.id, players: game.players.length });
  const first = currentPlayer(game);
  await sendMessage(chatId,
`🔥 <b>Ván đấu bắt đầu!</b>

Lượt đầu: <a href="tg://user?id=${first.userId}">${html(first.firstName || first.username || first.userId)}</a>
Hãy nói cụm bất kỳ từ ${MIN_SYLLABLES}-${MAX_SYLLABLES} tiếng.
Dùng: <code>/noi học sinh</code>
⏱️ Thời gian: <b>${game.secondsPerTurn}s</b>`);
}

async function cmdScore(msg) {
  const chatId = msg.chat.id;
  await upsertPlayer(chatId, msg.from);
  const stats = await getPlayerStats(chatId, msg.from.id);
  await answer(chatId,
`🏅 <b>Điểm của ${html(msg.from.first_name || msg.from.username || msg.from.id)}</b>

Tổng điểm: <b>${stats?.score || 0}</b>
Số ván: <b>${stats?.games || 0}</b>
Số trận thắng: <b>${stats?.wins || 0}</b>
Miss: <b>${stats?.misses || 0}</b>`, msg.message_id);
}

async function cmdLeaderboard(chatId) {
  const rows = await getLeaderboard(chatId, 10);
  if (!rows.length) return sendMessage(chatId, 'Chưa có dữ liệu bảng xếp hạng.');
  const text = rows.map((p, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    const name = p.firstName || p.username || p.userId;
    return `${medal} ${html(name)} — ${p.score || 0} điểm, ${p.wins || 0} thắng, ${p.games || 0} ván`;
  }).join('\n');
  await sendMessage(chatId, `🏆 <b>Bảng xếp hạng nối chữ</b>\n\n${text}`);
}

async function cmdHint(msg) {
  const chatId = msg.chat.id;
  const game = ensureGameDefaults(await loadGame(chatId) || {});
  if (game.status !== 'playing') return answer(chatId, 'Chưa có ván đang chơi.', msg.message_id);
  if (!game.requiredKey) return answer(chatId, 'Lượt đầu chưa có chữ bắt buộc. Hãy nói cụm bất kỳ.', msg.message_id);

  const local = SUGGESTIONS[game.requiredKey] || [];
  let unused = local.filter(w => {
    const parsed = parseCandidate(w);
    return parsed.ok && !game.usedWords[parsed.key] && !findReorderedPhraseConflict(game, parsed) && !localMeaningReject(parsed);
  }).slice(0, 5);

  if (AI_HINTS_ENABLED && aiReady()) {
    const aiList = await aiSuggestWords(game.required, game.usedWords);
    for (const w of aiList) {
      if (unused.length >= 8) break;
      if (!unused.some(x => compactKey(x) === compactKey(w))) unused.push(w);
    }
  }

  if (!unused.length) {
    const aiNote = aiReady() ? 'AI cũng chưa nghĩ ra cụm chắc chắn.' : 'Muốn gợi ý thông minh hơn thì thêm OPENAI_API_KEY.';
    return answer(chatId, `Bot chưa có gợi ý cho chữ “${html(game.required)}”. ${aiNote} Tự dùng nội công đi 😄`, msg.message_id);
  }
  await answer(chatId, `💡 Gợi ý cho chữ <b>${html(game.required)}</b>: ${unused.map(html).join(', ')}`, msg.message_id);
}


async function cmdAskAI(msg, args) {
  const chatId = msg.chat.id;
  if (!aiReady()) return answer(chatId, '🧠 AI chưa bật. Hãy điền OPENAI_API_KEY, cài package openai rồi restart bot.', msg.message_id);
  if (!AI_FREE_CHAT_ENABLED) return answer(chatId, '🧠 Lệnh hỏi AI đang bị tắt bằng AI_FREE_CHAT_ENABLED=false.', msg.message_id);
  const left = aiCooldownLeft(chatId, msg.from.id);
  if (left > 0) return answer(chatId, `⏳ Chờ ${left}s nữa rồi hỏi AI tiếp để tránh tốn phí/spam.`, msg.message_id);
  const question = String(args || '').trim();
  if (!question) return answer(chatId, 'Dùng: <code>/ai hỏi gì đó</code> hoặc <code>/ai gợi ý chiến thuật nối chữ</code>', msg.message_id);
  if (question.length > AI_MAX_ASK_CHARS) return answer(chatId, `Câu hỏi quá dài. Tối đa ${AI_MAX_ASK_CHARS} ký tự.`, msg.message_id);
  markAiUsed(chatId, msg.from.id);
  const game = ensureGameDefaults(await loadGame(chatId) || {});
  const reply = await aiAsk(question, game, msg.from);
  if (!reply) return answer(chatId, 'AI đang bận hoặc lỗi API. Kiểm tra OPENAI_API_KEY/quota/log server.', msg.message_id);
  await answer(chatId, `🧠 <b>Thiên Đạo AI</b>\n\n${html(reply)}`, msg.message_id);
}

async function cmdCheckPhrase(msg, args) {
  const chatId = msg.chat.id;
  if (!aiReady()) return answer(chatId, '🧠 AI chưa bật. Hãy điền OPENAI_API_KEY, cài package openai rồi restart bot.', msg.message_id);
  const phrase = String(args || '').trim();
  if (!phrase) return answer(chatId, 'Dùng: <code>/kiemtra học sinh</code>', msg.message_id);
  const left = aiCooldownLeft(chatId, msg.from.id);
  if (left > 0) return answer(chatId, `⏳ Chờ ${left}s nữa rồi kiểm tra tiếp.`, msg.message_id);
  markAiUsed(chatId, msg.from.id);
  const game = ensureGameDefaults(await loadGame(chatId) || {});
  const verdict = await aiJudgePhrase(phrase, game);
  if (!verdict) return answer(chatId, 'AI không trả được kết quả. Kiểm tra log server.', msg.message_id);
  const icon = verdict.valid ? '✅' : '❌';
  await answer(chatId,
`${icon} <b>AI xét cụm:</b> ${html(phrase)}
Độ tin: <b>${Math.round((verdict.confidence || 0) * 100)}%</b>
Lý do: ${html(verdict.reason || 'không có')}${verdict.suggestion ? `\nGợi ý: ${html(verdict.suggestion)}` : ''}`, msg.message_id);
}

async function cmdAiStatus(msg) {
  const chatId = msg.chat.id;
  await answer(chatId,
`🧠 <b>Trạng thái AI</b>

Kết nối: <b>${aiReady() ? 'BẬT' : 'TẮT'}</b>
Model: <code>${html(OPENAI_MODEL)}</code>
OPENAI_API_KEY: <b>${OPENAI_API_KEY ? 'đã có' : 'chưa có'}</b>
Package openai: <b>${OpenAI ? 'đã cài' : 'chưa cài'}</b>
AI chấm từ khi chơi: <b>${AI_VALIDATE_MOVES ? 'bật' : 'tắt'}</b>
AI gợi ý: <b>${AI_HINTS_ENABLED ? 'bật' : 'tắt'}</b>
AI hỏi đáp /ai: <b>${AI_FREE_CHAT_ENABLED ? 'bật' : 'tắt'}</b>
Chặn từ đảo: <b>${BLOCK_REORDERED_WORDS ? 'bật' : 'tắt'}</b>
Lọc từ rác cục bộ: <b>${LOCAL_GARBAGE_FILTER ? 'bật' : 'tắt'}</b>
Chấm AI nghiêm: <b>${AI_STRICT_MEANING ? 'bật' : 'tắt'}</b>
Chặn tiếng đệm/câu hỏi: <b>${BLOCK_FILLER_WORDS ? 'bật' : 'tắt'}</b>
Chặn lặp tiếng: <b>${BLOCK_DUPLICATE_SYLLABLES ? 'bật' : 'tắt'}</b>`, msg.message_id);
}

async function cmdSkip(msg) {
  const chatId = msg.chat.id;
  const game = ensureGameDefaults(await loadGame(chatId) || {});
  if (game.status !== 'playing') return answer(chatId, 'Không có ván đang chơi.', msg.message_id);
  if (now() < game.turnDeadline) return answer(chatId, `Chưa hết giờ. Còn ${secondsLeft(game.turnDeadline)}s.`, msg.message_id);
  await handleTimeout(game, 'manual');
}

async function cmdUndo(msg) {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id, chatId))) return answer(chatId, '⛔ Chỉ admin mới hủy từ cuối.', msg.message_id);
  const game = ensureGameDefaults(await loadGame(chatId) || {});
  if (game.status !== 'playing') return answer(chatId, 'Không có ván đang chơi.', msg.message_id);
  const last = game.moveHistory.pop();
  if (!last) return answer(chatId, 'Chưa có từ nào để hủy.', msg.message_id);
  delete game.usedWords[last.wordKey];
  const p = game.players.find(x => x.userId === last.userId);
  if (p) p.score = Math.max(0, (p.score || 0) - 1);
  game.currentWord = last.prevWord || '';
  game.required = last.beforeRequired || '';
  game.requiredKey = last.beforeRequiredKey || '';
  game.turnIndex = last.turnIndexBefore || 0;
  game.turnDeadline = now() + game.secondsPerTurn * 1000;
  await incPlayer(chatId, last.userId, { score: -1 });
  await saveGame(game);
  await logEvent(chatId, 'word_undone', { by: msg.from.id, word: last.word, userId: last.userId });
  await sendMessage(chatId, `↩️ Admin đã hủy từ cuối: <b>${html(last.word)}</b>. Lượt quay lại người đã nhập từ đó.`);
}

async function cmdEndGame(msg) {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id, chatId))) return answer(chatId, '⛔ Chỉ admin mới kết thúc ván.', msg.message_id);
  const game = ensureGameDefaults(await loadGame(chatId) || {});
  if (!['signup', 'playing'].includes(game.status)) return answer(chatId, 'Không có ván đang chạy.', msg.message_id);
  await finishGame(game, 'admin_end');
}

async function cmdResetGame(msg) {
  const chatId = msg.chat.id;
  if (!(await isAdmin(msg.from.id, chatId))) return answer(chatId, '⛔ Chỉ admin mới reset ván.', msg.message_id);
  await deleteGame(chatId);
  await logEvent(chatId, 'game_reset', { by: msg.from.id });
  await sendMessage(chatId, '🧹 Đã reset ván hiện tại. Dùng /taovan để tạo ván mới.');
}

async function acceptMove(msg, rawCandidate, byCommand = false) {
  const chatId = msg.chat.id;
  const game = ensureGameDefaults(await loadGame(chatId) || {});
  if (game.status !== 'playing') {
    if (byCommand) await answer(chatId, 'Chưa có ván đang chơi. Admin dùng /taovan rồi /batdau.', msg.message_id);
    return;
  }
  const cur = currentPlayer(game);
  if (!cur) return;
  if (String(msg.from.id) !== String(cur.userId)) {
    if (byCommand) await answer(chatId, `Chưa tới lượt bạn. Đang tới lượt ${html(cur.firstName || cur.username || cur.userId)}.`, msg.message_id);
    return;
  }
  if (now() > game.turnDeadline) {
    await handleTimeout(game, 'late_move');
    return;
  }
  const parsed = parseCandidate(rawCandidate);
  if (!parsed.ok) return answer(chatId, `❌ ${html(parsed.reason)}`, msg.message_id);
  if (game.usedWords[parsed.key]) return answer(chatId, `❌ Cụm <b>${html(parsed.phrase)}</b> đã được dùng trong ván này.`, msg.message_id);

  const garbageReason = localMeaningReject(parsed);
  if (garbageReason) return answer(chatId, `❌ Không nhận cụm <b>${html(parsed.phrase)}</b>. ${html(garbageReason)}`, msg.message_id);

  const reorderedConflict = findReorderedPhraseConflict(game, parsed);
  if (reorderedConflict) {
    return answer(chatId, `❌ Không nhận cụm <b>${html(parsed.phrase)}</b> vì chỉ đảo thứ tự tiếng của cụm đã dùng: <b>${html(reorderedConflict)}</b>.`, msg.message_id);
  }

  if (game.requiredKey && parsed.firstKey !== game.requiredKey) {
    return answer(chatId, `❌ Sai chữ nối. Cụm mới phải bắt đầu bằng <b>${html(game.required)}</b>.`, msg.message_id);
  }

  if (AI_VALIDATE_MOVES && aiReady()) {
    const verdict = await aiValidateMove(parsed, game);
    await logEvent(chatId, 'ai_word_checked', { userId: msg.from.id, word: parsed.phrase, verdict });
    const rejectThreshold = AI_STRICT_MEANING ? Math.min(AI_MIN_REJECT_CONFIDENCE, 0.55) : AI_MIN_REJECT_CONFIDENCE;
    if (verdict && verdict.valid === false && verdict.confidence >= rejectThreshold) {
      return answer(chatId,
`❌ <b>AI trọng tài không duyệt:</b> ${html(parsed.phrase)}
Lý do: ${html(verdict.reason || 'cụm chưa đủ rõ nghĩa')}${verdict.suggestion ? `
Gợi ý sửa: ${html(verdict.suggestion)}` : ''}

Admin có thể tắt chấm AI bằng <code>AI_VALIDATE_MOVES=false</code> nếu muốn chơi thoáng hơn.`, msg.message_id);
    }
  }

  const turnIndexBefore = game.turnIndex;
  const historyItem = {
    userId: String(msg.from.id),
    word: parsed.phrase,
    wordKey: parsed.key,
    beforeRequired: game.required || '',
    beforeRequiredKey: game.requiredKey || '',
    afterRequired: parsed.last,
    afterRequiredKey: parsed.lastKey,
    prevWord: game.currentWord || '',
    turnIndexBefore,
    at: new Date()
  };

  game.usedWords[parsed.key] = { userId: String(msg.from.id), at: new Date(), word: parsed.phrase };
  game.moveHistory.push(historyItem);
  game.currentWord = parsed.phrase;
  game.required = parsed.last;
  game.requiredKey = parsed.lastKey;
  cur.score = (cur.score || 0) + 1;
  cur.misses = 0;
  await incPlayer(chatId, msg.from.id, { score: 1 });
  await logEvent(chatId, 'word_accepted', { userId: msg.from.id, word: parsed.phrase, required: game.required });

  const next = nextTurn(game);
  await saveGame(game);

  await sendMessage(chatId,
`✅ ${mention(msg.from)} nối: <b>${html(parsed.phrase)}</b>

🔗 Chữ tiếp theo: <b>${html(parsed.last)}</b>
👉 Lượt: <a href="tg://user?id=${next.userId}">${html(next.firstName || next.username || next.userId)}</a>
⏱️ ${game.secondsPerTurn}s. Dùng <code>/noi ${html(parsed.last)} ...</code>`);
}

async function handleTimeout(game, reason = 'timer') {
  ensureGameDefaults(game);
  if (game.status !== 'playing') return;
  const chatId = game.chatId;
  if (now() < game.turnDeadline && reason !== 'force') return;
  const cur = currentPlayer(game);
  if (!cur) return;
  cur.misses = (cur.misses || 0) + 1;
  await incPlayer(chatId, cur.userId, { misses: 1 });
  let text = `⏰ <a href="tg://user?id=${cur.userId}">${html(cur.firstName || cur.username || cur.userId)}</a> hết giờ, miss ${cur.misses}/${MAX_MISSES}.`;
  if (cur.misses >= MAX_MISSES) {
    cur.alive = false;
    text += `\n💀 Bị loại khỏi ván.`;
    await logEvent(chatId, 'player_eliminated', { userId: cur.userId, reason });
    const alive = alivePlayers(game);
    if (alive.length <= 1) {
      await saveGame(game);
      await sendMessage(chatId, text);
      await finishGame(game, 'last_alive');
      return;
    }
    if (game.turnIndex >= alive.length) game.turnIndex = 0;
  } else {
    nextTurn(game);
  }
  const next = currentPlayer(game);
  game.turnDeadline = now() + game.secondsPerTurn * 1000;
  await saveGame(game);
  await sendMessage(chatId, `${text}\n\n👉 Lượt tiếp theo: <a href="tg://user?id=${next.userId}">${html(next.firstName || next.username || next.userId)}</a>\n🔗 Bắt đầu bằng: <b>${html(game.required || 'tự do')}</b>`);
}

async function finishGame(game, reason = 'finished') {
  ensureGameDefaults(game);
  game.status = 'ended';
  game.endedAt = new Date();
  const sorted = [...game.players].sort((a, b) => (b.score || 0) - (a.score || 0));
  const topScore = sorted[0]?.score || 0;
  const winners = sorted.filter(p => (p.score || 0) === topScore && topScore > 0);
  for (const w of winners) await incPlayer(game.chatId, w.userId, { wins: 1 });
  await saveGame(game);
  await logEvent(game.chatId, 'game_ended', { reason, winners: winners.map(w => w.userId), topScore });
  const winnerText = winners.length ? winners.map(w => `<a href="tg://user?id=${w.userId}">${html(w.firstName || w.username || w.userId)}</a>`).join(', ') : 'không có';
  const board = sorted.map(playerLine).join('\n') || 'Không có dữ liệu.';
  await sendMessage(game.chatId,
`🏁 <b>Ván nối chữ kết thúc!</b>

👑 Thắng ván: ${winnerText}

<b>Kết quả</b>
${board}

Tạo ván mới: /taovan 45`);
}

async function handleMessage(msg) {
  if (!msg || !msg.text || !msg.chat || !msg.from || msg.from.is_bot) return;
  if (!isAllowedChat(msg.chat)) return;
  const chatId = msg.chat.id;
  const actionKey = `${chatId}:${msg.from.id}`;
  const last = recentAction.get(actionKey) || 0;
  if (now() - last < 650) return;
  recentAction.set(actionKey, now());

  const command = parseCommand(msg.text);
  if (command) {
    const { cmd, args } = command;
    switch (cmd) {
      case 'start':
      case 'help':
      case 'trogiup':
        return cmdHelp(chatId);
      case 'luat':
        return cmdRules(chatId);
      case 'layid':
        return answer(chatId, `🆔 Chat ID: <code>${html(chatId)}</code>\n👤 User ID: <code>${html(msg.from.id)}</code>\nGroup username: <code>${html(msg.chat.username || '')}</code>`, msg.message_id);
      case 'taovan':
      case 'newgame':
        return cmdCreateGame(msg, args);
      case 'dangky':
      case 'join':
        return cmdJoin(msg);
      case 'roi':
      case 'leave':
        return cmdLeave(msg);
      case 'danhsach':
      case 'players':
        return cmdList(chatId);
      case 'batdau':
      case 'startgame':
        return cmdStartGame(msg);
      case 'noi':
        return acceptMove(msg, args, true);
      case 'goiy':
      case 'hint':
        return cmdHint(msg);
      case 'ai':
      case 'thientri':
      case 'thiendao':
        return cmdAskAI(msg, args);
      case 'kiemtra':
      case 'xettu':
      case 'checktu':
        return cmdCheckPhrase(msg, args);
      case 'aistatus':
        return cmdAiStatus(msg);
      case 'boqua':
      case 'skip':
        return cmdSkip(msg);
      case 'diem':
      case 'score':
        return cmdScore(msg);
      case 'bxh':
      case 'top':
        return cmdLeaderboard(chatId);
      case 'huytu':
      case 'undo':
        return cmdUndo(msg);
      case 'ketthuc':
      case 'endgame':
        return cmdEndGame(msg);
      case 'resetgame':
        return cmdResetGame(msg);
      case 'ping':
        return answer(chatId, 'pong ✅', msg.message_id);
      default:
        return;
    }
  }

  if (NORMAL_TEXT_MODE) {
    const game = ensureGameDefaults(await loadGame(chatId) || {});
    if (game.status === 'playing') {
      const cur = currentPlayer(game);
      if (cur && String(cur.userId) === String(msg.from.id)) {
        return acceptMove(msg, msg.text, false);
      }
    }
  }
}

async function pollLoop() {
  while (!shuttingDown) {
    try {
      const updates = await telegram('getUpdates', {
        offset: pollingOffset,
        timeout: 25,
        allowed_updates: ['message']
      });
      for (const u of updates) {
        pollingOffset = Math.max(pollingOffset, u.update_id + 1);
        await handleMessage(u.message);
      }
    } catch (e) {
      console.error('pollLoop error:', e.message);
      await sleep(2500);
    }
  }
}

async function timerLoop() {
  if (!mongoDb) {
    for (const game of Array.from(memory.games.values())) {
      if (game.status === 'playing' && game.turnDeadline && now() > game.turnDeadline) await handleTimeout(game, 'timer');
    }
    return;
  }
  const expired = await mongoDb.collection('games').find({ status: 'playing', turnDeadline: { $gt: 0, $lt: now() } }).limit(10).toArray();
  for (const game of expired) await handleTimeout(game, 'timer');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, bot: BOT_USERNAME, mongo: Boolean(mongoDb), ai: aiReady(), model: aiReady() ? OPENAI_MODEL : null, time: new Date().toISOString() }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false }));
  });
  server.listen(PORT, () => console.log(`Health server listening on :${PORT}`));
}

async function main() {
  initOpenAI();
  await initDb();
  startHealthServer();
  try {
    await telegram('deleteWebhook', { drop_pending_updates: false });
  } catch (e) {
    console.warn('deleteWebhook warning:', e.message);
  }
  const me = await telegram('getMe');
  console.log(`Bot started: @${me.username}`);
  setInterval(() => timerLoop().catch(e => console.error('timerLoop error:', e.message)), 5000);
  await pollLoop();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function shutdown() {
  shuttingDown = true;
  console.log('Shutting down...');
  try { if (mongoClient) await mongoClient.close(); } catch {}
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
