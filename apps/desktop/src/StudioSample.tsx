import { useRef, useState, type DragEvent } from 'react';
import { importSample } from './studio-engine';
import type { SamplerSound } from './song-format';

/** A sample's own name, from its path in the song's folder: "Samples/kick 01.wav" is "kick 01". */
export const sampleName = (file: string) => file.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || file;

/** Whether a drag carries files from the computer. */
export const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Where a sampler's or a pad's sample goes (Live 12, 36.8 and 25.6.1): its name once it has one, else a place to drop
 * a sound file from the computer, with Choose for the same by a file picker, and Remove. The file is copied into the
 * song's Samples folder, so the song keeps working wherever it goes.
 */
export function SampleSlot({ label, songPath, sample, onSample }: { label: string; songPath: string; sample: SamplerSound | undefined; onSample: (s: SamplerSound | null) => void }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const take = async (file: File | undefined) => {
    if (!file || !songPath) return;
    setBusy(true);
    setProblem(null);
    try {
      const got = await importSample(songPath, file);
      if ('file' in got) onSample({ ...(sample ?? {}), file: got.file });
      else setProblem(got.problem);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  };
  return (
    <div className="studio-sample" role="group" aria-label={label} data-over={over || undefined} data-empty={!sample || undefined} aria-busy={busy || undefined}
      onDragOver={(e) => { if (!carriesFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (!carriesFiles(e)) return; e.preventDefault(); e.stopPropagation(); setOver(false); void take(e.dataTransfer.files[0]); }}>
      <span className="studio-sample-name" title={sample?.file}>{busy ? 'Adding…' : sample ? sampleName(sample.file) : 'Drop a WAV file here'}</span>
      <span className="studio-sample-actions">
        <button type="button" className="studio-sample-btn" onClick={() => pick.current?.click()}>{sample ? 'Replace…' : 'Choose…'}</button>
        {sample && <button type="button" className="studio-sample-btn" onClick={() => onSample(null)}>Remove</button>}
      </span>
      <input ref={pick} type="file" accept=".wav,.wave,audio/wav,audio/x-wav" hidden onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
      {problem && <p className="studio-sample-problem" role="alert">{problem}</p>}
    </div>
  );
}
