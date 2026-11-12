import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pictureOfVideo } from '../picture';

/**
 * Show Mobius: the computer's camera, live, until the person takes one still or cancels. Only the still is kept, and
 * only as a picture attached to the message being written; the camera is turned off as soon as the dialog closes.
 */
export function CameraDialog({ onTake, onClose }: { onTake: (picture: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let live = true;
    const media = navigator.mediaDevices as MediaDevices | undefined;
    if (!media?.getUserMedia) { setProblem('There is no camera to use here.'); return; }
    media.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then((s) => {
      if (!live) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      if (video.current) { video.current.srcObject = s; void video.current.play().then(() => setReady(true)).catch(() => setProblem('The camera could not start.')); }
    }).catch(() => setProblem('The camera is not available, or using it was not allowed.'));
    return () => { live = false; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const take = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    onTake(pictureOfVideo(v));
    onClose();
  };
  return createPortal(
    <div className="cal-modal-layer" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="camera-dialog" role="dialog" aria-modal="true" aria-label="Show Mobius">
        <h2>Show Mobius</h2>
        <p className="camera-note">Point the camera at something. Only the still you take is attached, and nothing is kept unless you send it.</p>
        <div className="camera-view">
          <video ref={video} muted playsInline aria-label="Camera" />
          {problem && <p className="camera-problem" role="alert">{problem}</p>}
        </div>
        <div className="camera-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={!ready || problem !== null} onClick={take}>Take</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
