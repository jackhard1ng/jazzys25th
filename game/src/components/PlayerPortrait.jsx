import { useState, useEffect } from 'react';

// Vite serves static assets under import.meta.env.BASE_URL.
// This evaluates to "/jazzys25th/" in production and "/" in dev.
const BASE = import.meta.env.BASE_URL || '/';

// ============================================================
// PlayerPortrait
// Designed for the gold-framed gallery portraits in
// game/public/headshots/. Renders at the given WIDTH, with the
// natural aspect ratio of the underlying image (most are taller
// than wide because of the frame).
// Fallback chain:
//   1. uploaded photo (base64 data URL from the player's phone)
//   2. /headshots/<name>.png
//   3. /headshots/<name>.jpg
//   4. /headshots/<name>.jpeg
//   5. first-letter silhouette card
// ============================================================
export default function PlayerPortrait({
  name,
  photo,
  width = 100,        // pixel width (height is natural)
  aspectRatio = '4/5',// silhouette + uploaded-photo fallback aspect
  border,
  glow = false,
  faded = false,
}) {
  const [errorIdx, setErrorIdx] = useState(0);

  const slug = String(name || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  const sources = [];
  if (photo) sources.push(photo);
  sources.push(`${BASE}headshots/${slug}.png`);
  sources.push(`${BASE}headshots/${slug}.jpg`);
  sources.push(`${BASE}headshots/${slug}.jpeg`);

  // Reset to first source whenever the relevant inputs change.
  useEffect(() => { setErrorIdx(0); }, [slug, photo]);

  const exhausted = errorIdx >= sources.length;

  const sizeStyle = typeof width === 'number'
    ? { width: `${width}px` }
    : { width };

  if (exhausted) {
    // Silhouette card — keeps the gallery layout consistent when a
    // headshot file is missing (e.g. someone joins with a custom name).
    return (
      <div
        aria-label={name}
        style={{
          ...sizeStyle,
          aspectRatio,
          borderRadius: 6,
          background: 'var(--dark-gray, #2a2a2a)',
          border: border || '1px solid var(--stone, #3a3a3a)',
          boxShadow: glow ? '0 0 16px rgba(218,165,32,0.5)' : undefined,
          opacity: faded ? 0.45 : 1,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          flexShrink: 0,
          fontFamily: 'var(--font-heading)',
          color: 'var(--gold)',
          letterSpacing: 2,
          padding: 8,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <span style={{
          position: 'absolute',
          top: '40%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: 'clamp(1.6rem, 6vw, 2.4rem)',
          color: 'var(--text-dim)',
          opacity: 0.8,
        }}>
          {(name || '?').charAt(0).toUpperCase()}
        </span>
        <span style={{
          fontSize: '0.7rem',
          textAlign: 'center',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          width: '100%',
        }}>
          {name}
        </span>
      </div>
    );
  }

  return (
    <img
      src={sources[errorIdx]}
      alt={name}
      onError={() => setErrorIdx(i => i + 1)}
      style={{
        ...sizeStyle,
        height: 'auto',
        display: 'block',
        flexShrink: 0,
        border: border || undefined,
        borderRadius: 4,
        boxShadow: glow ? '0 0 22px rgba(218,165,32,0.6)' : undefined,
        opacity: faded ? 0.45 : 1,
        transition: 'opacity 0.3s, box-shadow 0.3s',
      }}
    />
  );
}
