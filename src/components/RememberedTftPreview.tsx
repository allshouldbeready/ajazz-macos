import { useEffect, useRef } from "react";
import { useTftPreview } from "../tft-preview";
import { writePreviewRgba } from "../tft-preview-codec";

/** Uses only the local successful-upload cache; it never contacts the keyboard. */
export function RememberedTftPreview({
  className = "",
  paused = false,
}: {
  className?: string;
  paused?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { frames, loading } = useTftPreview();

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || frames.length === 0) return;
    const image = context.createImageData(128, 128);
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function draw() {
      if (!context) return;
      const frame = frames[index];
      writePreviewRgba(frame.pixels, image.data);
      context.putImageData(image, 0, 0);
      index = (index + 1) % frames.length;
      if (!paused && frames.length > 1) timer = setTimeout(draw, frame.delay);
    }
    draw();
    return () => clearTimeout(timer);
  }, [frames, paused]);

  const description = frames.length
    ? "Last uploaded display animation, remembered on this Mac"
    : "No saved preview. Upload an image in Display to show it here. Earlier uploads were not saved by the app.";

  return (
    <div className={`relative aspect-square overflow-hidden bg-black ${className}`} title={description}>
      {frames.length ? (
        <canvas ref={canvas} width={128} height={128} role="img" aria-label={description}
          className="block h-full w-full" />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-0.5 text-center text-white/50" aria-label={description}>
          <span className="text-[6px] font-medium tracking-wider">AK820</span>
          <span className="text-[4px]">{loading ? "Loading…" : "DISPLAY"}</span>
        </div>
      )}
    </div>
  );
}
