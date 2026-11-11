'use client';

import { useEffect, useRef } from 'react';

// Fires once per mount to register this visit; the count shown on the page is the
// value as of render (like YouTube — your own view lands on the pre-increment number).
export function RecordView({ slug }: { slug: string }) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    fetch(`/api/views/${slug}`, { method: 'POST' }).catch(() => {});
  }, [slug]);

  return null;
}
