const SHIMMER = "shimmer relative overflow-hidden bg-[#e7ece5]";

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col">
      <div className={`aspect-square rounded-2xl ${SHIMMER}`} />
      <div className={`mt-2 h-3.5 w-3/4 rounded-full ${SHIMMER}`} />
      <div className="mt-1.5 flex items-center justify-between">
        <div className={`h-4 w-16 rounded-full ${SHIMMER}`} />
        <div className={`h-2.5 w-12 rounded-full ${SHIMMER}`} />
      </div>
      <div className={`mt-2.5 h-9 w-full rounded-xl ${SHIMMER}`} />
    </div>
  );
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      aria-hidden
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5"
    >
      {Array.from({ length: count }, (_, index) => (
        <ProductCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function ProductRailSkeleton() {
  return (
    <div aria-hidden className="mt-5">
      <div className={`h-4 w-36 rounded-full ${SHIMMER}`} />
      <div className="mt-3 flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="w-36 shrink-0 sm:w-44">
            <div className={`aspect-square rounded-2xl ${SHIMMER}`} />
            <div className={`mt-2 h-3 w-3/4 rounded-full ${SHIMMER}`} />
            <div className={`mt-1.5 h-3.5 w-14 rounded-full ${SHIMMER}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function MoreProductsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5">
      {Array.from({ length: count }, (_, index) => (
        <ProductCardSkeleton key={index} />
      ))}
    </div>
  );
}
