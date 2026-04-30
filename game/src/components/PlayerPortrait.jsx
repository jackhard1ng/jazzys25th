import { useState, useEffect } from 'react';

// Vite serves static assets under import.meta.env.BASE_URL.
// This evaluates to "/jazzys25th/" in production and "/" in dev.
const BASE = import.meta.env.BASE_URL || '/';

// ============================================================
// PlayerPortrait — round portrait with a fallback chain:
//   1. uploaded photo (base64 data URL)
//   2. /headshots/{name}.png   (case-insensitive, from public/)
//   3. /headshots/{name}.jpg
//   4. /headshots/{name}.jpeg
//   5. silhouette
// Headshots in game/public/headshots/ are bundled into the deploy.
// ============================================================
export default function PlayerPortrait({
  name,
  photo,
  size = 48,
  rounded = true,
  border,
  glow = false,
}) {
  const [errorIdx, setErrorIdx] = useState(0);

  const slug = String(name || '').toLowerCase().replace(/\s+/g, '-');
  const sources = [];
  if (photo) sources.push(photo);
  sources.push(`${BASE}headshots/${slug}.png`);
  sources.push(`${BASE}headshots/${slug}.jpg`);
  sources.push(`${BASE}headshots/${slug}.jpeg`);

  // Reset to first source whenever the relevant inputs change.
  useEffect(() => { setErrorIdx(0); }, [slug, photo]);

  const exhausted = errorIdx >= sources.length;

  const isNumeric = typeof size === 'number';
  const baseStyle = {
    width: size,
    height: size,
    borderRadius: rounded ? '50%' : 6,
    objectFit: 'cover',
    background: 'var(--dark-gray, #2a2a2a)',
    border: border || undefined,
    boxShadow: glow ? '0 0 14px rgba(218,165,32,0.45)' : undefined,
    flexShrink: 0,
    display: 'block',
  };

  if (exhausted) {
    return (
      <div
        aria-label={name}
        style={{
          ...baseStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: isNumeric ? size * 0.45 : '1.2rem',
          color: 'var(--text-dim)',
          fontFamily: 'var(--font-heading)',
          letterSpacing: 1,
        }}
      >
        {(name || '?').charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={sources[errorIdx]}
      alt={name}
      onError={() => setErrorIdx(i => i + 1)}
      style={baseStyle}
    />
  );
}
