"use client";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

export interface ReferralRow {
  id: string;
  status: "pending" | "completed";
  code: string;
  referrer_points: number;
  referee_points: number;
  referrer_name: string | null;
  referee_name: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface ReferralStats {
  total: number;
  completed: number;
  pending: number;
  points_awarded: number;
}

export interface ReferralsResponse {
  referrals: ReferralRow[];
  stats: ReferralStats;
}

/**
 * Admin referrals list + aggregate stats (GET /api/referrals).
 * Returns the full set of referral rows (referrer, referee, status, date)
 * plus headline counters for the stats cards.
 */
export function useReferrals() {
  return useQuery<ReferralsResponse>({
    queryKey: ["referrals"],
    queryFn: () => apiFetch<ReferralsResponse>("/api/referrals"),
  });
}
