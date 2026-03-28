import { useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

type CardImageCarouselProps = {
  title: string;
  imageUrls: string[];
  compact?: boolean;
};

export function CardImageCarousel({ title, imageUrls, compact = false }: CardImageCarouselProps) {
  const [index, setIndex] = useState(0);
  const frameClass = compact ? "aspect-[5/4]" : "aspect-[4/3]";
  const controlClass = compact ? "h-8 w-8" : "h-9 w-9";
  const overlayPaddingClass = compact ? "p-3" : "p-4";
  const titleClass = compact ? "text-xs font-semibold" : "text-sm font-semibold";

  if (imageUrls.length === 0) {
    return (
      <div className={`flex ${frameClass} items-center justify-center rounded-[22px] border border-dashed border-slate-200 bg-[linear-gradient(135deg,_#f8fafc,_#eef2ff)] text-slate-300`}>
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }

  const currentUrl = imageUrls[index]!;

  return (
    <div className="relative overflow-hidden rounded-[22px] border border-slate-200 bg-slate-100">
      <img className={`${frameClass} w-full object-cover`} src={currentUrl} alt={title} />
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent ${overlayPaddingClass}`}>
        <p className={`${titleClass} text-white`}>{title}</p>
      </div>
      {imageUrls.length > 1 ? (
        <>
          <button
            className={`absolute left-3 top-3 flex ${controlClass} items-center justify-center rounded-full bg-white/85 text-slate-900 shadow-lg backdrop-blur`}
            type="button"
            onClick={() => setIndex((current) => (current === 0 ? imageUrls.length - 1 : current - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            className={`absolute right-3 top-3 flex ${controlClass} items-center justify-center rounded-full bg-white/85 text-slate-900 shadow-lg backdrop-blur`}
            type="button"
            onClick={() => setIndex((current) => (current + 1) % imageUrls.length)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
            {index + 1}/{imageUrls.length}
          </div>
        </>
      ) : null}
    </div>
  );
}
