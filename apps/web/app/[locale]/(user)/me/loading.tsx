import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while a profile tab renders. Every /me/* route is dynamic (the layout
 * above reads the session), so without this boundary a tab click waits for the
 * server with the previous panel frozen on screen — which reads as a full page
 * reload. Only the panel below the header swaps; the header stays mounted.
 */
export default function MyProfileTabLoading() {
  return (
    <div className="min-h-screen bg-muted pb-30 pt-4">
      <div className="mx-auto max-w-7xl rounded-sm bg-card p-4">
        <Skeleton className="h-8 w-44" />
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="mt-6 h-12" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    </div>
  );
}
