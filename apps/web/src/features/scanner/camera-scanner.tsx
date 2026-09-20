import { Camera, CameraOff, Flashlight, FlashlightOff } from 'lucide-react';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Camera scanning with two backends:
 *
 * 1. The browser's native BarcodeDetector where it exists (Chrome and Edge on
 *    Android) — zero extra bytes.
 * 2. A dynamically-imported ZXing decoder everywhere else (iOS Safari and
 *    desktop), loaded only when the camera is actually opened, so the main
 *    bundle does not pay for it. The keyboard-wedge scanner still covers the
 *    daily flow; this is a convenience on top.
 */
const SCAN_FORMATS = ['code_128', 'code_39', 'ean_13', 'qr_code', 'data_matrix'];

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

const nativeScanSupported = (): boolean =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices;

export const cameraScanSupported = (): boolean =>
  typeof window !== 'undefined' && !!navigator.mediaDevices;

export function CameraScanner({ onDetect }: { onDetect: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    // Suppressing repeats by remembering what was just read, rather than by
    // sleeping, keeps the loop running: the next phone is picked up the instant
    // it appears instead of after a fixed pause.
    const recent = new Map<string, number>();

    /**
     * Reports every symbol it manages to read, whatever it holds.
     *
     * The camera used to hand back only IMEIs and drop everything else in
     * silence, so scanning the wrong barcode on a box looked identical to the
     * camera being broken. The screen doing the scanning is what knows whether
     * a payload is usable, and it is the one that can say so properly.
     */
    const reportDigits = (raw: string): boolean => {
      const value = raw.trim();
      if (!value) return false;

      const now = performance.now();
      for (const [seen, at] of recent) if (now - at > 2500) recent.delete(seen);
      if (recent.has(value)) return false;

      recent.set(value, now);
      onDetect(value);
      return true;
    };

    const startNative = async (): Promise<void> => {
      const detector = new window.BarcodeDetector!({ formats: SCAN_FORMATS });
      const tick = async () => {
        if (stopped || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          for (const code of codes) {
            if (reportDigits(code.rawValue)) {
              setStatus(null);
              break;
            }
          }
        } catch {
          /* a dropped frame is not worth reporting */
        }
        raf = requestAnimationFrame(() => void tick());
      };
      void tick();
    };

    const startFallback = async (): Promise<void> => {
      // Roughly 115 kB gzipped, fetched only now. Say so, or the operator taps
      // the button on a slow link and thinks nothing happened.
      setStatus('Preparing the scanner…');
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');

      // Hints have to go in through the constructor. Assigning
      // `reader.possibleFormats` afterwards reads as though it configures the
      // decoder and does nothing at all — which quietly cost us TRY_HARDER, the
      // setting that makes ZXing persist with a marginal 1D symbol instead of
      // giving up after one pass.
      const hints = new Map<number, unknown>([
        [
          DecodeHintType.POSSIBLE_FORMATS,
          [
            BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39,
            BarcodeFormat.EAN_13,
            BarcodeFormat.QR_CODE,
            BarcodeFormat.DATA_MATRIX,
          ],
        ],
        [DecodeHintType.TRY_HARDER, true],
      ]);
      const reader = new BrowserMultiFormatReader(hints as never);

      // Own decode loop rather than decodeFromVideoElement: the library's
      // built-in loop aborts permanently if a frame ever raises anything other
      // than a not-found error, which happens on iOS before the first frame is
      // ready — and then the camera sits on with nothing scanning. Here any
      // error just means "try the next frame".
      setStatus('Point the camera at the label and hold still.');
      // Decode a downscaled crop of the guide band rather than the whole frame.
      // A full 1080p pass costs well over a tenth of a second in pure
      // JavaScript; the band the operator is actually aiming at is a fraction
      // of that, and cropping raises the hit rate too because the decoder is
      // no longer distracted by shelving and packaging around the label.
      const scratch = document.createElement('canvas');
      const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });

      const frameForDecode = (video: HTMLVideoElement): HTMLCanvasElement | null => {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh || !scratchCtx) return null;

        // Crop for speed, but never scale down. A Code 128 IMEI carries about
        // 110 modules, so halving a 1920-wide frame leaves under three pixels
        // per bar and the decoder cannot resolve it — the same failure as
        // accepting a 640x480 capture, reintroduced by the downscale that used
        // to be here. Take the middle third of the height at full resolution.
        const cropH = Math.max(1, Math.round(vh / 3));
        const cropY = Math.round((vh - cropH) / 2);

        scratch.width = vw;
        scratch.height = cropH;
        scratchCtx.drawImage(video, 0, cropY, vw, cropH, 0, 0, vw, cropH);
        return scratch;
      };

      /**
       * The same band turned on its side.
       *
       * ZXing's one-dimensional readers sweep horizontal lines, so a label held
       * across the frame reads while the identical label held along it does not.
       * Alternating orientation costs one pass in two and removes the "it only
       * works sometimes" that operators would otherwise just learn to live with.
       */
      const turned = document.createElement('canvas');
      const turnedCtx = turned.getContext('2d', { willReadFrequently: true });
      const turnedFrame = (source: HTMLCanvasElement): HTMLCanvasElement | null => {
        if (!turnedCtx) return null;
        turned.width = source.height;
        turned.height = source.width;
        turnedCtx.save();
        turnedCtx.translate(turned.width / 2, turned.height / 2);
        turnedCtx.rotate(Math.PI / 2);
        turnedCtx.drawImage(source, -source.width / 2, -source.height / 2);
        turnedCtx.restore();
        return turned;
      };

      // iPhone wide lenses cannot focus closer than roughly ten centimetres, so
      // a label held right up to the glass is simply blurred — the commonest
      // reason the camera looks broken when it is working perfectly. Say so
      // rather than leaving the operator waving the phone about.
      const startedAt = Date.now();
      let hinted = false;

      let lastAttempt = 0;
      let pass = 0;
      const tick = async () => {
        if (stopped || !videoRef.current) return;
        const now = Date.now();
        if (now - lastAttempt >= 120) {
          lastAttempt = now;
          try {
            const band = frameForDecode(videoRef.current);
            if (!band) throw new Error('no frame yet');

            pass += 1;
            const frame = pass % 2 === 0 ? (turnedFrame(band) ?? band) : band;

            const result = reader.decodeFromCanvas(frame);
            // Repeats are already suppressed by value for a couple of seconds,
            // so there is nothing to gain from pausing the loop here.
            if (reportDigits(result.getText())) setStatus(null);
          } catch {
            /* a frame with no readable code — try the next one */
            if (!hinted && Date.now() - startedAt > 7000) {
              hinted = true;
              setStatus('No luck yet — hold the label about 15 cm away, fill the box, and keep it steady.');
            }
          }
        }
        raf = requestAnimationFrame(() => void tick());
      };
      void tick();
    };

    const start = async () => {
      try {
        // Default capture is often 640x480, which cannot resolve the narrow
        // bars of a Code 128 IMEI symbol — the single biggest reason camera
        // scanning felt broken. Ask for something that can, and for the
        // continuous autofocus a close-up label needs.
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
            // Non-standard but widely honoured, and harmless where it is not.
            ...({ focusMode: 'continuous', advanced: [{ focusMode: 'continuous' }] } as object),
          },
        });
        if (stopped) return;
        const video = videoRef.current;
        if (!video) throw new Error('no video element');
        video.srcObject = stream;
        await video.play();

        if (nativeScanSupported()) {
          await startNative();
        } else {
          await startFallback();
        }
      } catch (err) {
        // Permission is the usual stumbling block, especially on iOS where it
        // has to be granted per site — worth saying plainly rather than
        // blaming the camera.
        const name = (err as { name?: string } | null)?.name ?? '';
        setError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'Camera access was blocked. Allow it for this site in your browser settings, or use the scanner.'
            : name === 'NotFoundError'
              ? 'No camera on this device. Use the scanner or type the IMEI.'
              : 'Camera unavailable. Use the scanner or type the IMEI.',
        );
        setStatus(null);
        setActive(false);
      }
    };

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      setStatus(null);
      trackRef.current = null;
      setTorchAvailable(false);
      setTorchOn(false);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [active, onDetect]);

  if (!cameraScanSupported()) return null;

  return (
    <div className="space-y-2">
      <Button variant="outline" className="w-full gap-2" onClick={() => setActive((a) => !a)}>
        {active ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
        {active ? 'Stop camera' : 'Scan with camera'}
      </Button>

      {active && (
        <div className="relative overflow-hidden rounded-lg border bg-black">
          <video ref={videoRef} playsInline muted className="h-56 w-full object-cover" />
          {/* A narrow guide: holding the symbol across the frame is what gets
              enough pixels per bar to decode a dense Code 128. */}
          <div className="pointer-events-none absolute inset-x-4 top-1/2 h-20 -translate-y-1/2 rounded border-2 border-white/70" />
          {torchAvailable && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="absolute bottom-2 end-2 gap-1.5"
              onClick={() => {
                const next = !torchOn;
                void trackRef.current
                  // `torch` is not in the DOM typings yet, though browsers that
                  // expose the capability honour it.
                  ?.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
                  .then(() => setTorchOn(next))
                  .catch(() => setTorchAvailable(false));
              }}
            >
              {torchOn ? <FlashlightOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
              {torchOn ? 'Light off' : 'Light'}
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {active && status && !error && (
        <p className="text-xs text-muted-foreground">{status}</p>
      )}
    </div>
  );
}
