"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getPublicReportReasons,
  type PublicReportReason,
} from "@/actions/reports";

/** Same shape the reactions provider uses to tell real rows from mock ones. */
export const REAL_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The admin-managed reasons, fetched once the dialog first opens. */
export function useReportReasons(
  targetType: "user" | "listing",
  enabled: boolean,
): { reasons: PublicReportReason[]; isLoading: boolean } {
  const { data = [], isLoading } = useQuery({
    queryKey: ["report-reasons", targetType],
    queryFn: () => getPublicReportReasons(targetType),
    enabled,
    staleTime: 5 * 60_000,
  });
  return { reasons: data, isLoading: enabled && isLoading };
}
