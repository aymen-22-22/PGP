import { Camera, CameraOff, Flashlight, FlashlightOff } from 'lucide-react';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/utils';

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

export function CameraScanner({
  onDetect,
  active: controlled,
  onActiveChange,
  hideToggle = false,
  square = false,
}: {
  onDetect: (value: string) => void;
  /** Set to drive the camera from outside, e.g. from one big button. */
  active?: boolean;
  onActiveChange?: (active: boolean) => void;
  hideToggle?: boolean;
  /** A big square view with light and 2× zoom; reads the square, so QR codes fit whole. */
  square?: boolean;
}) {
  const { t } = useI18n();
  // Read from inside the camera callbacks, which outlive a render.
  const tr = useRef(t);
  tr.current = t;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [own, setOwn] = useState(false);
  const active = controlled ?? own;
  const setActive = (next: boolean | ((a: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(active) : next;
    if (onActiveChange) onActiveChange(value);
    else setOwn(value);
  };
  const setActiveRef = useRef(setActive);
  setActiveRef.current = setActive;
  const [torchOn, setTorchOn] = useState(false);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // 2× for small labels: the lens zooms where the phone allows it, otherwise
  // the picture and the read area are both cropped to the middle.
  const [zoomed, setZoomed] = useState(false);
  const [hardwareZoom, setHardwareZoom] = useState<{ min: number; max: number } | null>(null);
  const digitalZoom = useRef(false);
  digitalZoom.current = zoomed && !hardwareZoom;
  // The frame turns green for a moment when something is read.
  const [hit, setHit] = useState(false);
  const hitTimer = useRef<ReturnType<typeof setTimeout>>();

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
      setHit(true);
      clearTimeout(hitTimer.current);
      hitTimer.current = setTimeout(() => setHit(false), 450);
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
      setStatus(tr.current('camera.preparing'));
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
      setStatus(tr.current('camera.point'));
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
        if (square) {
          // The square guide in the middle: a QR code is as tall as it is
          // wide, so a thin band would cut it in half.
          const side = Math.max(1, Math.round((Math.min(vw, vh) * 0.8) / (digitalZoom.current ? 2 : 1)));
          scratch.width = side;
          scratch.height = side;
          scratchCtx.drawImage(video, Math.round((vw - side) / 2), Math.round((vh - side) / 2), side, side, 0, 0, side, side);
          return scratch;
        }
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
              setStatus(tr.current('camera.noLuck'));
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
        // The light, where the phone has one: dark shelves are the usual reason
        // a label will not read.
        const track = stream.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean; zoom?: { min: number; max: number } };
        setTorchAvailable(!!caps.torch);
        setHardwareZoom(caps.zoom && caps.zoom.max >= 1.5 ? caps.zoom : null);
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
            ? tr.current('camera.blocked')
            : name === 'NotFoundError'
              ? tr.current('camera.none')
              : tr.current('camera.unavailable'),
        );
        setStatus(null);
        setActiveRef.current(false);
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
      setZoomed(false);
      setHardwareZoom(null);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [active, onDetect, square]);

  if (!cameraScanSupported()) return null;

  return (
    <div className="space-y-2">
      {!hideToggle && (
        <Button variant="outline" className="w-full gap-2" onClick={() => setActive((a) => !a)}>
          {active ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
          {active ? t('camera.stop') : t('camera.start')}
        </Button>
      )}

      {active && square && (
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover transition-transform"
            style={digitalZoom.current ? { transform: 'scale(2)' } : undefined}
          />
          {/* Square guide with corner marks: QR codes and barcodes alike. Green for a moment on a read. */}
          <div className="pointer-events-none absolute inset-[10%]">
            {[
              '-left-1 -top-1 rounded-tl-2xl border-l-[6px] border-t-[6px]',
              '-right-1 -top-1 rounded-tr-2xl border-r-[6px] border-t-[6px]',
              '-bottom-1 -left-1 rounded-bl-2xl border-b-[6px] border-l-[6px]',
              '-bottom-1 -right-1 rounded-br-2xl border-b-[6px] border-r-[6px]',
            ].map((corner) => (
              <span
                key={corner}
                className={cn('absolute h-12 w-12 transition-colors', corner, hit ? 'border-green-400' : 'border-white')}
              />
            ))}
          </div>
        </div>
      )}
      {active && square && (
        <div className="flex justify-center gap-6">
          <button
            type="button"
            aria-label={torchOn ? t('camera.lightOff') : t('camera.light')}
            aria-pressed={torchOn}
            disabled={!torchAvailable}
            onClick={() => {
              const next = !torchOn;
              void trackRef.current
                ?.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
                .then(() => setTorchOn(next))
                .catch(() => setTorchAvailable(false));
            }}
            className={cn(
              'flex h-16 w-16 items-center justify-center rounded-full active:scale-95 disabled:opacity-40',
              torchOn ? 'bg-yellow-300 text-black' : 'bg-muted text-foreground',
            )}
          >
            {torchOn ? <FlashlightOff className="h-8 w-8" /> : <Flashlight className="h-8 w-8" />}
          </button>
          <button
            type="button"
            aria-label="2×"
            aria-pressed={zoomed}
            onClick={() => {
              const next = !zoomed;
              setZoomed(next);
              if (hardwareZoom) {
                const level = next ? Math.min(2, hardwareZoom.max) : Math.max(1, hardwareZoom.min);
                void trackRef.current
                  ?.applyConstraints({ advanced: [{ zoom: level }] } as unknown as MediaTrackConstraints)
                  .catch(() => setHardwareZoom(null));
              }
            }}
            className={cn(
              'flex h-16 w-16 items-center justify-center rounded-full text-xl font-black active:scale-95',
              zoomed ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
            )}
          >
            {zoomed ? '1×' : '2×'}
          </button>
        </div>
      )}

      {active && !square && (
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
              {torchOn ? t('camera.lightOff') : t('camera.light')}
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
