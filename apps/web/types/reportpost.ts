export type ReportPost = {
  ReportPostID: string;
  postId: number | string;
  userId: string;
  ReportReasonID: string;
  ReportPostDescription: string;
  Status: "Pending" | "Approved" | "Rejected";
  CreatedAt: string;
  ReviewdBy?: string;
};
