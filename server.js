require('dotenv').config();
// FHM website backend
// Secrets stay on the server. Never place Gemini/OpenAI/Supabase service-role keys in index.html.
// PowerShell example:
//   $env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
//   $env:SUPABASE_KEY="YOUR_PUBLISHABLE_KEY"
//   $env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"   # only if RLS blocks question reads
//   node server.js

const http = require('http');
const fs = require('fs');

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const DB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;
const EDGE_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/generate-answer` : '';
// Server-side embedding
// The embedding is generated on the server so users do not need
// to download/run the embedding model on their own device.
let embedderPromise = null;

async function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');

      return pipeline(
  'feature-extraction',
  'Xenova/multilingual-e5-small',
  {
    dtype: 'q8'
  }
);
    })().catch((error) => {
      embedderPromise = null;
      throw error;
    });
  }

  return embedderPromise;
}

async function getEmbedding(text) {
  const embedder = await getEmbedder();

  const output = await embedder(
    'query: ' + text,
    {
      pooling: 'mean',
      normalize: true,
    }
  );

  const embedding = Array.from(output.data);

  if (embedding.length !== 384) {
    throw new Error(
      `Unexpected embedding dimension: ${embedding.length}. Expected 384.`
    );
  }

  return embedding;
}

const TOPIC_ALIASES = {
  'tawhid': 'التوحيد',
  'islam_pillars': 'أركان الإسلام',
  'iman_pillars': 'أركان الإيمان',
  'prayer': 'الصلاة',
  'fasting': 'الصيام',
  'zakat': 'الزكاة',
  'hajj': 'الحج',
  'الحج والعمرة': 'الحج',
  'seerah': 'السيرة النبوية',
  'purification': 'نواقض الطهارة',
  'islam_intro': 'التعريف بالإسلام',
};

function json(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, apikey, authorization',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(data));
}

async function supabaseGet(path) {
  if (!SUPABASE_URL || !DB_KEY) throw new Error('Supabase environment variables are missing');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: DB_KEY,
      Authorization: `Bearer ${DB_KEY}`,
    },
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${JSON.stringify(data).slice(0,500)}`);
  return data;
}

async function callFhm(payload) {
  if (!EDGE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_URL/SUPABASE_KEY are missing');
  const r = await fetch(EDGE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(`generate-answer ${r.status}: ${JSON.stringify(data).slice(0,700)}`);
  return data;
}

async function readBody(req) {
  let b = '';
  for await (const c of req) b += c;
  return b;
}

async function topicIdFromName(name) {
  const n = TOPIC_ALIASES[name] || name;
  const rows = await supabaseGet(`topics?select=id&name=eq.${encodeURIComponent(n)}&limit=1`);
  if (!Array.isArray(rows) || !rows.length) throw new Error('Unknown topic: ' + n);
  return rows[0].id;
}

function parseOptions(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : Object.values(parsed || {}); }
    catch { return value.split('|').map(x => x.trim()).filter(Boolean); }
  }
  return [];
}

function findCorrectIndex(options, correctAnswer) {
  const raw = String(correctAnswer ?? '').trim();
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 0 && n < options.length) return n;
    if (n >= 1 && n <= options.length) return n - 1;
  }
  return options.findIndex(x => String(x).trim() === raw);
}

// English UI is supported even though the approved FHM question bank is currently Arabic.
// These are translations of the existing database questions/options, not new religious content.
const QUESTION_EN = {
  'ما المقصود بالتوحيد اصطلاحًا؟': {
    question: 'What is meant by Tawhid in terminology?',
    options: ['Singling out Allah in what is unique to Him in Lordship, Divinity, Names and Attributes', 'Establishing prayer only', 'Giving zakat', 'Fasting Ramadan']
  },
  'كم ركنًا بُني عليه الإسلام؟': {
    question: 'How many pillars is Islam built upon?',
    options: ['Three', 'Four', 'Five', 'Six']
  },
  'بماذا تُفتتح الصلاة وتُختتم؟': {
    question: 'How is the prayer begun and concluded?',
    options: ['With takbir and taslim', 'With taslim and takbir', 'With wudu and takbir', 'With supplication and taslim']
  },
  'ما المجالات التي يختص بها الله من الربوبية والألوهية والأسماء والصفات؟': {
    question: 'What areas are uniquely attributed to Allah: Lordship, Divinity, Names and Attributes?',
    options: ['Lordship, Divinity, Names and Attributes']
  },
  'كيف عرّف المصدر الصلاة اصطلاحًا؟': {
    question: 'How does the source define prayer in terminology?',
    options: []
  },
  'ما الذي ذكره الحديث ضمن أركان الإسلام؟': {
    question: 'What did the hadith mention among the pillars of Islam?',
    options: []
  }
};

function localizeQuestion(row, language) {
  const options = parseOptions(row.options);
  let question = row.question;
  let outOptions = options;
  if (language === 'en' && QUESTION_EN[row.question]) {
    question = QUESTION_EN[row.question].question;
    if (QUESTION_EN[row.question].options.length === options.length) outOptions = QUESTION_EN[row.question].options;
  }
  const originalIndex = findCorrectIndex(options, row.correct_answer);
  return {
    id: row.id,
    topic_id: row.topic_id,
    question,
    options: outOptions,
    correctIndex: originalIndex < 0 ? null : originalIndex,
    difficulty: row.difficulty || null,
  };
}

async function fetchQuestions(language='ar', type='comprehension', topicId=null) {
  const lang = language === 'en' ? 'ar' : language;
  let path = `questions?select=id,topic_id,question,options,correct_answer,difficulty&question_type=eq.${encodeURIComponent(type)}&language=eq.${encodeURIComponent(lang)}`;
  if (topicId !== null) path += `&topic_id=eq.${topicId}`;
  path += type === 'diagnostic' ? '&order=id.asc&limit=3' : '&order=id.asc&limit=1';
  return await supabaseGet(path);
}

async function getQuestion(topicName, type='comprehension', language='ar') {
  const topicId = await topicIdFromName(topicName);
  const rows = await fetchQuestions(language, type, topicId);
  if (!Array.isArray(rows) || !rows.length) return null;
  return localizeQuestion(rows[0], language);
}

async function getDiagnostic(language='ar') {
  const rows = await fetchQuestions(language, 'diagnostic');
  return (rows || []).map(row => localizeQuestion(row, language));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

  if (req.method === 'GET' && req.url === '/api/health') {
    return json(res, 200, {
      ok: true,
      supabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_KEY),
      dbReadConfigured: Boolean(SUPABASE_URL && DB_KEY),
      rag: 'generate-answer + pgvector',
      embedding: 'multilingual-e5-small (384)',
    });
  }

if (req.method === 'POST' && req.url === '/api/ask') {
  try {
    const body = JSON.parse(await readBody(req));

    const {
      question,
      age_group = 'adult',
      learner_type = 'general',
      current_level = 'beginner',
      language = 'ar'
    } = body;

    if (!question) {
      return json(res, 400, {
        error: 'question is required'
      });
    }

    // Generate the embedding on the server
    const query_embedding = await getEmbedding(
      String(question).slice(0, 500)
    );

    // Send the question + server-generated embedding
    // to the source-grounded FHM RAG function.
    const data = await callFhm({
      question: String(question).slice(0, 500),
      query_embedding,
      age_group,
      learner_type,
      current_level,
      language
    });

    return json(res, 200, data);

  } catch (e) {
    console.error('ASK ERROR:', e.message);

    return json(res, 500, {
      error: 'FHM service error',
      detail: e.message
    });
  }
}

  if (req.method === 'GET' && req.url.startsWith('/api/question')) {
    try {
      const u = new URL(req.url, 'http://localhost');
      const topic = u.searchParams.get('topic') || '';
      const language = u.searchParams.get('language') || 'ar';
      const q = await getQuestion(topic, 'comprehension', language);
      return json(res, 200, q || {});
    } catch (e) {
      console.error('QUESTION ERROR:', e.message);
      return json(res, 500, { error: e.message });
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/diagnostic')) {
    try {
      const u = new URL(req.url, 'http://localhost');
      const language = u.searchParams.get('language') || 'ar';
      return json(res, 200, await getDiagnostic(language));
    } catch (e) {
      console.error('DIAGNOSTIC ERROR:', e.message);
      return json(res, 500, { error: e.message });
    }
  }

  if (req.method === 'GET') {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const safe = rel.split('/').some(part => part === '..') ? null : rel;
      if (!safe) return json(res, 400, { error: 'Invalid path' });
      const file = require('path').join(__dirname, safe);
      if (!file.startsWith(__dirname + require('path').sep) && file !== require('path').join(__dirname,'index.html')) return json(res, 403, { error: 'Forbidden' });
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'Not found' });
      const ext = require('path').extname(file).toLowerCase();
      const types = {'.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
      res.writeHead(200, {'content-type': types[ext] || 'application/octet-stream'});
      return res.end(fs.readFileSync(file));
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  return json(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`FHM website: http://localhost:${PORT}`);
});
