"use server";

import { serverFetch, ApiError } from "@/lib/api/client";

export interface ReportReason {
  id: string;
  targetType: "user" | "listing";
  reason: string;
}

export interface UserReportView {
  id: string;
  reporterId: string;
  reporterName: string;
  targetUserId: string;
  targetName: string;
  targetUsername: string | null;
  reasonText: string | null;
  description: string | null;
  imagePaths: string[];
  /** Public URLs for imagePaths — what the dashboard renders. */
  imageUrls: string[];
  status: "pending" | "approved" | "rejected";
  reviewedById: string | null;
  reviewerName: string | null;
  createdAt: string;
}

interface BackendUserReport {
  id: string;
  reporterId: string;
  targetUserId: string;
  reporterName: string;
  targetName: string;
  targetUsername: string | null;
  reasonText: string | null;
  description: string | null;
  imagePaths: string[];
  /** Public URLs for imagePaths — what the dashboard renders. */
  imageUrls: string[];
  status: "pending" | "approved" | "rejected";
  reviewedById: string | null;
  reviewerName: string | null;
  createdAt: string;
}

export interface ListingReportView {
  id: string;
  reporterId: string;
  reporterName: string;
  listingId: string;
  listingTitle: string | null;
  listingOwnerName: string | null;
  listingOwnerUsername: string | null;
  reasonText: string | null;
  description: string | null;
  imagePaths: string[];
  status: "pending" | "approved" | "rejected";
  reviewedById: string | null;
  reviewerName: string | null;
  createdAt: string;
}

interface BackendListingReport {
  id: string;
  reporterId: string;
  listingId: string;
  reporterName: string;
  listingTitle: string | null;
  listingOwnerName: string | null;
  listingOwnerUsername: string | null;
  reasonText: string | null;
  description: string | null;
  imagePaths: string[];
  status: "pending" | "approved" | "rejected";
  reviewedById: string | null;
  reviewerName: string | null;
  createdAt: string;
}

export async function getReportReasons(
  type: "user" | "listing",
): Promise<ReportReason[]> {
  const { data } = await serverFetch<ReportReason[]>(
    `/admin/reports/reasons?type=${type}`,
  );
  return data;
}

export async function getUserReports(): Promise<UserReportView[]> {
  const { data } = await serverFetch<BackendUserReport[]>(
    "/admin/reports/users",
  );
  return data;
}

export async function updateUserReportStatus(
  id: string,
  status: "pending" | "approved" | "rejected",
) {
  try {
    await serverFetch(`/admin/reports/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ApiError ? err.message : "Update failed",
    };
  }
}

export async function deleteUserReport(id: string) {
  try {
    await serverFetch(`/admin/reports/users/${id}`, { method: "DELETE" });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ApiError ? err.message : "Delete failed",
    };
  }
}

export async function getListingReports(): Promise<ListingReportView[]> {
  const { data } = await serverFetch<BackendListingReport[]>(
    "/admin/reports/listings",
  );
  return data;
}

export async function updateListingReportStatus(
  id: string,
  status: "pending" | "approved" | "rejected",
) {
  try {
    await serverFetch(`/admin/reports/listings/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ApiError ? err.message : "Update failed",
    };
  }
}

export async function deleteListingReport(id: string) {
  try {
    await serverFetch(`/admin/reports/listings/${id}`, { method: "DELETE" });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ApiError ? err.message : "Delete failed",
    };
  }
}
