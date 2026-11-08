import { useEffect, useRef, useState } from 'react';
import { burstAt, PALETTES } from '../../../shared/fx/index.ts';
import { Button, Icons } from '../../../shared/ui.tsx';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Copies a spoiler-free result line, with a little burst and a "Copied!" state. */
export function ShareButton({ text, size = 'md', variant = 'primary', className = '' }: { text: string; size?: 'sm' | 'md' | 'lg'; variant?: 'primary' | 'good' | 'secondary'; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <div ref={ref} className={className}>
      <Button
        size={size}
        variant={state === 'copied' ? 'good' : variant}
        className="w-full"
        onClick={async () => {
          const ok = await copyText(text);
          setState(ok ? 'copied' : 'failed');
          if (ok) burstAt(ref.current, { count: 16, colors: PALETTES.good, power: 5, size: 4 });
        }}
        title={text}
      >
        {state === 'copied' ? (
          <>
            {Icons.check('h-5 w-5')} Copied!
          </>
        ) : state === 'failed' ? (
          'Copy failed'
        ) : (
          <>
            {Icons.share('h-5 w-5')} Share result
          </>
        )}
      </Button>
    </div>
  );
}
