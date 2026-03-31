import { YoutubeTranscript } from 'youtube-transcript';

function extractVideoId(url) {
  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.trim().match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function googleTranslate(text, targetLang = 'en') {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const translated = data[0].map((chunk) => chunk[0]).join('');
    const detectedLang = data[2] || 'auto';
    return { translated, detectedLang };
  } catch (err) {
    const fallbackUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${targetLang}`;
    const res2 = await fetch(fallbackUrl);
    const data2 = await res2.json();
    return { translated: data2?.responseData?.translatedText || text, detectedLang: 'auto' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL is required.' });
  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL.' });
  let title = 'YouTube Video', thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, channelName = '';
  try {
    const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (oembedRes.ok) { const meta = await oembedRes.json(); title = meta.title || title; thumbnail = meta.thumbnail_url || thumbnail; channelName = meta.author_name || ''; }
  } catch (_) {}
  let rawTranscript = null, alreadyEnglish = false;
  try { rawTranscript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' }); alreadyEnglish = true; } catch (_) {}
  if (!rawTranscript || rawTranscript.length === 0) {
    try { rawTranscript = await YoutubeTranscript.fetchTranscript(videoId); }
    catch (err) { return res.status(404).json({ error: 'No captions found for this video.' }); }
  }
  if (!rawTranscript || rawTranscript.length === 0) return res.status(404).json({ error: 'No captions found.' });
  let detectedLang = 'en', processedTranscript;
  if (alreadyEnglish) {
    processedTranscript = rawTranscript.map(item => ({ offset: item.offset, duration: item.duration, originalText: null, text: item.text }));
  } else {
    processedTranscript = [];
    let batch = [], batchChars = 0;
    const flushBatch = async () => {
      if (!batch.length) return;
      const combined = batch.map(b => b.text.replace(/\|/g, ' ').trim()).join(' | ');
      try {
        const { translated, detectedLang: dl } = await googleTranslate(combined);
        detectedLang = dl;
        const parts = translated.split(' | ');
        batch.forEach((item, idx) => processedTranscript.push({ offset: item.offset, duration: item.duration, originalText: item.text, text: (parts[idx] || item.text).trim() }));
      } catch (_) {
        batch.forEach(item => processedTranscript.push({ offset: item.offset, duration: item.duration, originalText: item.text, text: item.text }));
      }
      batch = []; batchChars = 0;
    };
    for (const item of rawTranscript) {
      const txt = item.text || '';
      if (batchChars + txt.length > 400) { await flushBatch(); await new Promise(r => setTimeout(r, 80)); }
      batch.push(item); batchChars += txt.length;
    }
    await flushBatch();
  }
  const LANG_NAMES = { es:'Spanish',fr:'French',de:'German',pt:'Portuguese',it:'Italian',ru:'Russian',zh:'Chinese',ja:'Japanese',ko:'Korean',ar:'Arabic',hi:"Hindi",tr:'Turkish',pl:'Polish',nl:'Dutch',sv:'Swedish',uk:'Ukrainian',vi:"Vietnamese",th:'Thai',id:'Indonesian',cs:'Czech',ro:'Romanian',hu:'Hungarian',el:'Greek',he:'Hebrew',fa:'Persian' };
  const detectedLangName = LANG_NAMES[detectedLang] || detectedLang.toUpperCase();
  return res.status(200).json({ videoId, title, thumbnail, channelName, transcript: processedTranscript, wasTranslated: !alreadyEnglish, detectedLang, detectedLangName, segmentCount: processedTranscript.length });
}
