import type { RequestStatus } from "../../types/request.ts";

/** Never emoji-only — always paired with the text label, per the M5 requirement not to depend solely on emoji. */
export function formatStatusLabel(status: RequestStatus): string {
  switch (status) {
    case "PENDING":
      return "🟡 Pending";
    case "APPROVED":
      return "🟢 Approved";
    case "REJECTED":
      return "🔴 Rejected";
    case "CANCELLED":
      return "⚪ Cancelled";
    case "EXPIRED":
      return "⚪ Expired";
    default:
      return status;
  }
}
