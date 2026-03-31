import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';

// ─── Utility ──────────────────────────────────────────────────────────────────

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function toSRT(transcript) {
  return transcript
    .map((item, i) => {
      const start = item.offset;
      const end = item.offset + (item.duration || 3000);
      const fmt = (ms) => {
        const totalSec = Math.floor(ms / 1000);
        const ms_ = ms % 1000;
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms_).padStart(3, '0')}`;
      };
      return `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${item.text}\n`;
    })
    .join('\n');
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ width: 22, height: 22, border: '2.5px solid rgba(255,255,255,0.15)', borderTopColor: '#ff0000', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
  );
}

function SkeletonLine({ w = '100%', h = 14 }) {
  return (
    <div style={{ width: w, height: h, borderRadius: 6, background: 'linear-gradient(90deg, #1e1e1e 25%, #2a2a2a 50%, #1e1e1e 75%)', backgroundSize: '800px 100%', animation: 'shimmer 1.4s infinite' }} />
  );
}

function Badge({ children, color = '#ff0000' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: color + '22', color: color, border: `1px solid ${color}44` }}>
      {children}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('Fetching transcript…');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [activeIdx, setActiveIdx] = useState(-1);
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);

  const playerRef = useRef(null);
  const transcriptRef = useRef(null);
  const segmentRefs = useRef([]);
  const syncIntervalRef = useRef(null);
  const inputRef = useRef(null);

  // ── Load YouTube IFrame API ───────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.YT) return;
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  }, []);

  // ── Init player after result ──────────────────────────────────────────────
  useEffect(() => {
    if (!result) return;
    setActiveIdx(-1);
    setPlayerReady(false);

    const init = () => {
      if (!window.YT || !window.YT.Player) {
        setTimeout(init, 200);
        return;
      }
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch (_) {}
      }
      playerRef.current = new window.YT.Player('yt-player', {
        videoId: result.videoId,
        playerVars: { autoplay: 0, modestbranding: 1, rel: 0 },
        events: {
          onReady: () => setPlayerReady(true),
        },
      });
    };

    // Small delay to let the DOM render the player div
    setTimeout(init, 300);

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [result]);

  // ── Sync subtitles with video time ───────────────────────────────────────
  useEffect(() => {
    if (!playerReady || !result) return;

    syncIntervalRef.current = setInterval(() => {
      try {
        const player = playerRef.current;
        if (!player || typeof player.getCurrentTime !== 'function') return;
        const timeMs = player.getCurrentTime() * 1000;

        let idx = -1;
        for (let i = result.transcript.length - 1; i >= 0; i--) {
          if (timeMs >= result.transcript[i].offset) {
            idx = i;
            break;
          }
        }

        setActiveIdx((prev) => {
          if (prev !== idx) {
            // Auto-scroll transcript panel
            if (idx >= 0 && segmentRefs.current[idx] && transcriptRef.current) {
              const el = segmentRefs.current[idx];
              const container = transcriptRef.current;
              const elTop = el.offsetTop;
              const center = elTop - container.clientHeight / 2 + el.clientHeight / 2;
              container.scrollTo({ top: center, behavior: 'smooth' });
            }
          }
          return idx;
        });
      } catch (_) {}
    }, 200);

    return () => clearInterval(syncIntervalRef.current);
  }, [playerReady, result]);

  // ── Translate ─────────────────────────────────────────────────────────────
  const handleTranslate = useCallback(async () => {
    if (!url.trim()) {
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    setActiveIdx(-1);
    const msgs = ['Fetching transcript…', 'Detecting language…', 'Translating to En.glish…', 'Almost there…'];
    let mi = 0;
    const msgInterval = setInterval(() => {
      mi = (mi + 1) % msgs.length;
      setLoadingMsg(msgs[mi]);
    }, 2200);

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      clearInterval(msgInterval);
      setLoading(false);
    }
  }, [url]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleTranslate();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch (_) {}
  };

  const handleSeek = (offsetMs) => {
    if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
      playerRef.current.seekTo(offsetMs / 1000, true);
      try { playerRef.current.playVideo(); } catch (_) {}
    }
  };

  const handleCopy = () => {
    if (!result) return;
    const text = result.transcript.map((s) => `[${formatTime(s.offset)}] ${s.text}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownloadSRT = () => {
    if (!result) return;
    downloadFile(toSRT(result.transcript), `${result.title.slice(0, 40)}.srt`, 'text/plain');
  };

  const handleDownloadTXT = () => {
    if (!result) return;
    const lines = result.transcript.map((s) => `[${formatTime(s.offset)}] ${s.text}`).join('\n');
    downloadFile(lines, `${result.title.slice(0, 40)}.txt`, 'text/plain');
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>YT Translate — YouTube Audio Translator</title>
        <meta name="description" content="Instantly translate any YouTube video into English. Paste a URL, get synced English subtitles." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </Head>

      <div style={s.page}>
        {/* ── Animated background blobs ─────────────────────────── */}
        <div style={s.blob1} />
        <div style={s.blob2} />

        {/* ── Header ──────────────────────────────────────────────── */}
        <header style={s.header}>
          <div style={s.logo}>
            <div style={s.logoIcon}>
              <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" fill="currentColor" opacity="0" />
                <path d="M10 16.5v-9l6 4.5-6 4.5z" fill="white" />
                <rect x="2" y="4" width="20" height="16" rx="4" stroke="white" strokeWidth="1.5" fill="none" />
              </svg>
            </div>
            <span style={s.logoText}>YT Translate</span>
          </div>
          <a href="https://github.com" target="_blank" rel="noreferrer" style={s.ghLink}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            Star on GitHub
          </a>
        </header>

        <main style={s.main}>
          {/* ── Hero ─────────────────────────────────────────────── */}
          {!result && (
            <section style={s.hero}>
              <div style={s.heroBadge}>
                <span style={{ color: '#ff0000' }}>●</span> Free · No sign-up · Any language
              </div>
              <h1 style={s.heroTitle}>
                Translate any YouTube video<br />
                <span style={s.heroAccent}>into English</span>
              </h1>
              <p style={s.heroSub}>
                Paste a YouTube link below. We grab the subtitles and translate them instantly — then sync them as you watch.
              </p>
            </section>
          )}

          {/* ── Input ────────────────────────────────────────────── */}
          <div style={s.inputCard}>
            <div style={s.inputRow}>
              <div style={s.inputWrap}>
                <svg style={s.inputIcon} viewBox="0 0 24 24" fill="none" width="18" height="18">
                  <path d="M10 16.5v-9l6 4.5-6 4.5z" fill="#ff0000" />
                  <rect x="2" y="4" width="20" height="16" rx="3" stroke="#555" strokeWidth="1.5" fill="none" />
                </svg>
                <input
                  ref={inputRef}
                  style={s.input}
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="https://youtube.com/watch?v=..."
                  spellCheck={false}
                />
                {url && (
                  <button style={s.clearBtn} onClick={() => setUrl('')} title="Clear">✕</button>
                )}
              </div>
              <button style={s.pasteBtn} onClick={handlePaste} title="Paste from clipboard">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                </svg>
                Paste
              </button>
              <button
                style={{ ...s.translateBtn, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
                onClick={handleTranslate}
                disabled={loading}
              >
                {loading ? (
                  <><Spinner /> {loadingMsg}</>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Translate
                  </>
                )}
              </button>
            </div>

            {/* Feature pills */}
            {!result && !loading && (
              <div style={s.pills}>
                {[['⚡', 'Instant'], ['🌍', '100+ Languages'], ['🎯', 'Synced Subtitles'], ['📄', 'Download SRT']].map(([icon, label]) => (
                  <div key={label} style={s.pill}>{icon} {label}</div>
                ))}
              </div>
            )}

            {/* Loading skeleton */}
            {loading && (
              <div style={{ padding: '16px 0 4px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SkeletonLine w="60%" h={12} />
                <SkeletonLine w="85%" h={12} />
                <SkeletonLine w="40%" h={12} />
              </div>
            )}
          </div>

          {/* ── Error ────────────────────────────────────────────── */}
          {error && (
            <div style={s.errorBox}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {/* ── Results ──────────────────────────────────────────── */}
          {result && (
            <div style={{ animation: 'fadeUp 0.5s ease forwards' }}>
              {/* Video info bar */}
              <div style={s.videoInfoBar}>
                <img src={result.thumbnail} alt="" style={s.videoThumb} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={s.videoTitle}>{result.title}</div>
                  <div style={s.videoMeta}>
                    {result.channelName && <span>{result.channelName}</span>}
                    {result.channelName && <span style={{ color: '#444' }}>·</span>}
                    <span>{result.segmentCount} segments</span>
                    {result.wasTranslated && (
                      <>
                        <span style={{ color: '#444' }}>·</span>
                        <Badge>🌍 {result.detectedLangName} → English</Badge>
                      </>
                    )}
                    {!result.wasTranslated && <Badge color="#22c55e">✓ English</Badge>}
                  </div>
                </div>
                <button style={s.newBtn} onClick={() => { setResult(null); setUrl(''); setError(''); setActiveIdx(-1); }}>
                  ← New video
                </button>
              </div>

              {/* Main split */}
              <div style={s.split}>
                {/* Left: video embed */}
                <div style={s.videoWrap}>
                  <div id="yt-player" style={s.playerEl} />
                  {!playerReady && (
                    <div style={s.playerPlaceholder}>
                      <img src={result.thumbnail} alt="" style={s.playerThumbBg} />
                      <div style={s.playerOverlay}>
                        <Spinner />
                      </div>
                    </div>
                  )}

                  {/* Active subtitle display */}
                  {activeIdx >= 0 && result.transcript[activeIdx] && (
                    <div style={s.liveSubtitle}>
                      {result.transcript[activeIdx].text}
                    </div>
                  )}
                </div>

                {/* Right: transcript panel */}
                <div style={s.transcriptPanel}>
                  {/* Toolbar */}
                  <div style={s.transcriptToolbar}>
                    <span style={s.transcriptLabel}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                      Transcript
                    </span>
                    {result.wasTranslated && (
                      <button
                        style={{ ...s.toggleBtn, background: showOriginal ? 'rgba(255,0,0,0.15)' : 'transparent', color: showOriginal ? '#ff4444' : '#888' }}
                        onClick={() => setShowOriginal((v) => !v)}
                      >
                        {showOriginal ? '🌐 Bilingual' : '🌐 Show original'}
                      </button>
                    )}
                  </div>

                  {/* Segments */}
                  <div ref={transcriptRef} style={s.segments}>
                    {result.transcript.map((seg, i) => {
                      const isActive = i === activeIdx;
                      return (
                        <div
                          key={i}
                          ref={(el) => (segmentRefs.current[i] = el)}
                          style={{
                            ...s.segment,
                            background: isActive ? 'rgba(255,0,0,0.12)' : 'transparent',
                            borderLeft: `3px solid ${isActive ? '#ff0000' : 'transparent'}`,
                            cursor: 'pointer',
                          }}
                          onClick={() => handleSeek(seg.offset)}
                        >
                          <span style={s.timestamp}>{formatTime(seg.offset)}</span>
                          <div style={s.segText}>
                            <div style={{ color: isActive ? '#fff' : '#ddd' }}>{seg.text}</div>
                            {showOriginal && seg.originalText && (
                              <div style={s.originalText}>{seg.originalText}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Export bar */}
              <div style={s.exportBar}>
                <span style={s.exportLabel}>Export as:</span>
                <button style={s.exportBtn} onClick={handleCopy}>
                  {copied ? '✓ Copied!' : (
                    <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg> Copy</>
                  )}
                </button>
                <button style={s.exportBtn} onClick={handleDownloadSRT}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  SRT Subtitles
                </button>
                <button style={s.exportBtn} onClick={handleDownloadTXT}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  Plain Text
                </button>
              </div>
            </div>
          )}

          {/* ── How it works ─────────────────────────────────────── */}
          {!result && !loading && (
            <section style={s.howSection}>
              <h2 style={s.howTitle}>How it works</h2>
              <div style={s.howGrid}>
                {[
                  { n: '1', icon: '📋', title: 'Paste a URL', desc: 'Drop any YouTube link — videos, Shorts, or just the video ID.' },
                  { n: '2', icon: '🧠', title: 'Auto-detect & translate', desc: 'We detect the language and translate every subtitle line to English.' },
                  { n: '3', icon: '🎬', title: 'Watch in sync', desc: 'Subtitles highlight automatically as the video plays. Click any line to jump.' },
                  { n: '4', icon: '⬇️', title: 'Export anywhere', desc: 'Download as .srt subtitle file or plain text. Use it in any video player.' },
                ].map(({ n, icon, title, desc }) => (
                  <div key={n} style={s.howCard}>
                    <div style={s.howNum}>{n}</div>
                    <div style={s.howIcon}>{icon}</div>
                    <div style={s.howCardTitle}>{title}</div>
                    <div style={s.howCardDesc}>{desc}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <footer style={s.footer}>
          <span>Made with ❤️ using Next.js · Not affiliated with YouTube</span>
        </footer>
      </div>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = {
  page: {
    minHeight: '100vh',
    background: '#0a0a0a',
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  blob1: {
    position: 'fixed',
    top: -200,
    left: -200,
    width: 600,
    height: 600,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(255,0,0,0.06) 0%, transparent 70%)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  blob2: {
    position: 'fixed',
    bottom: -200,
    right: -200,
    width: 500,
    height: 500,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(255,60,0,0.05) 0%, transparent 70%)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  header: {
    position: 'relative',
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 28px',
    borderBottom: '1px solid #1a1a1a',
    backdropFilter: 'blur(10px)',
    background: 'rgba(10,10,10,0.8)',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logoIcon: {
    width: 34,
    height: 34,
    background: '#ff0000',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontWeight: 800,
    fontSize: 18,
    letterSpacing: '-0.5px',
  },
  ghLink: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    borderRadius: 8,
    border: '1px solid #2a2a2a',
    background: '#141414',
    color: '#aaa',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 500,
    transition: 'color 0.2s, border-color 0.2s',
  },
  main: {
    position: 'relative',
    zIndex: 1,
    flex: 1,
    maxWidth: 1200,
    margin: '0 auto',
    width: '100%',
    padding: '40px 24px 60px',
  },
  hero: {
    textAlign: 'center',
    marginBottom: 40,
    animation: 'fadeUp 0.6s ease forwards',
  },
  heroBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 14px',
    borderRadius: 20,
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    fontSize: 12,
    color: '#888',
    marginBottom: 20,
    fontWeight: 500,
  },
  heroTitle: {
    fontSize: 'clamp(32px, 5vw, 58px)',
    fontWeight: 900,
    lineHeight: 1.15,
    letterSpacing: '-1.5px',
    marginBottom: 18,
  },
  heroAccent: {
    background: 'linear-gradient(135deg, #ff0000, #ff6b35)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  heroSub: {
    color: '#888',
    fontSize: 17,
    lineHeight: 1.6,
    maxWidth: 520,
    margin: '0 auto',
  },
  inputCard: {
    background: '#141414',
    border: '1px solid #232323',
    borderRadius: 16,
    padding: '20px 20px 16px',
    marginBottom: 24,
  },
  inputRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'stretch',
    flexWrap: 'wrap',
  },
  inputWrap: {
    flex: 1,
    minWidth: 220,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: 14,
    pointerEvents: 'none',
    flexShrink: 0,
  },
  input: {
    width: '100%',
    background: '#0f0f0f',
    border: '1px solid #2a2a2a',
    borderRadius: 10,
    color: '#f1f1f1',
    fontSize: 14,
    padding: '12px 40px 12px 42px',
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.2s',
  },
  clearBtn: {
    position: 'absolute',
    right: 12,
    background: 'none',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    fontSize: 13,
    padding: 4,
    lineHeight: 1,
  },
  pasteBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '12px 16px',
    borderRadius: 10,
    background: '#1e1e1e',
    border: '1px solid #2a2a2a',
    color: '#aaa',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  translateBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 24px',
    borderRadius: 10,
    background: '#ff0000',
    border: 'none',
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    transition: 'opacity 0.2s',
    minWidth: 140,
    justifyContent: 'center',
  },
  pills: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 14,
  },
  pill: {
    padding: '4px 12px',
    borderRadius: 20,
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    fontSize: 12,
    color: '#777',
    fontWeight: 500,
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '14px 18px',
    background: 'rgba(255,0,0,0.08)',
    border: '1px solid rgba(255,0,0,0.2)',
    borderRadius: 10,
    color: '#ff6b6b',
    fontSize: 14,
    marginBottom: 16,
  },
  videoInfoBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 18px',
    background: '#141414',
    border: '1px solid #232323',
    borderRadius: 12,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  videoThumb: {
    width: 80,
    height: 45,
    objectFit: 'cover',
    borderRadius: 6,
    flexShrink: 0,
  },
  videoTitle: {
    fontWeight: 700,
    fontSize: 15,
    marginBottom: 6,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  videoMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: '#777',
    flexWrap: 'wrap',
  },
  newBtn: {
    padding: '8px 14px',
    borderRadius: 8,
    background: '#1e1e1e',
    border: '1px solid #2a2a2a',
    color: '#aaa',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 500,
    flexShrink: 0,
  },
  split: {
    display: 'grid',
    gridTemplateColumns: '1fr 380px',
    gap: 16,
    alignItems: 'start',
  },
  videoWrap: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
    background: '#000',
    aspectRatio: '16/9',
  },
  playerEl: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  playerPlaceholder: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerThumbBg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    filter: 'brightness(0.3)',
  },
  playerOverlay: {
    position: 'relative',
    zIndex: 1,
  },
  liveSubtitle: {
    position: 'absolute',
    bottom: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.85)',
    color: '#fff',
    padding: '7px 16px',
    borderRadius: 6,
    fontSize: 15,
    fontWeight: 500,
    textAlign: 'center',
    maxWidth: '90%',
    backdropFilter: 'blur(4px)',
    zIndex: 5,
    pointerEvents: 'none',
    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
  },
  transcriptPanel: {
    background: '#141414',
    border: '1px solid #232323',
    borderRadius: 12,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 480,
  },
  transcriptToolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    borderBottom: '1px solid #1e1e1e',
    flexShrink: 0,
  },
  transcriptLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  toggleBtn: {
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid #2a2a2a',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 500,
    transition: 'all 0.2s',
  },
  segments: {
    overflowY: 'auto',
    flex: 1,
    padding: '6px 0',
  },
  segment: {
    display: 'flex',
    gap: 10,
    padding: '8px 14px',
    transition: 'background 0.2s',
    borderRadius: 4,
    margin: '2px 6px',
  },
  timestamp: {
    fontSize: 11,
    color: '#555',
    fontFamily: 'monospace',
    paddingTop: 2,
    flexShrink: 0,
    minWidth: 38,
  },
  segText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 1.5,
  },
  originalText: {
    marginTop: 3,
    fontSize: 11,
    color: '#555',
    fontStyle: 'italic',
  },
  exportBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '14px 18px',
    marginTop: 14,
    background: '#141414',
    border: '1px solid #232323',
    borderRadius: 12,
    flexWrap: 'wrap',
  },
  exportLabel: {
    fontSize: 13,
    color: '#666',
    fontWeight: 500,
    marginRight: 4,
  },
  exportBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 8,
    background: '#1e1e1e',
    border: '1px solid #2a2a2a',
    color: '#ccc',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'border-color 0.2s, color 0.2s',
  },
  howSection: {
    marginTop: 60,
    animation: 'fadeUp 0.7s ease 0.2s both',
  },
  howTitle: {
    fontSize: 22,
    fontWeight: 800,
    textAlign: 'center',
    marginBottom: 28,
    color: '#ddd',
  },
  howGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
  },
  howCard: {
    padding: '22px 20px',
    background: '#141414',
    border: '1px solid #1e1e1e',
    borderRadius: 14,
    transition: 'border-color 0.2s',
    position: 'relative',
  },
  howNum: {
    position: 'absolute',
    top: 14,
    right: 16,
    fontSize: 11,
    fontWeight: 700,
    color: '#333',
    fontFamily: 'monospace',
  },
  howIcon: {
    fontSize: 28,
    marginBottom: 12,
  },
  howCardTitle: {
    fontWeight: 700,
    fontSize: 15,
    marginBottom: 6,
  },
  howCardDesc: {
    fontSize: 13,
    color: '#666',
    lineHeight: 1.6,
  },
  footer: {
    position: 'relative',
    zIndex: 1,
    textAlign: 'center',
    padding: '20px 24px',
    borderTop: '1px solid #1a1a1a',
    fontSize: 12,
    color: '#444',
  },
};
