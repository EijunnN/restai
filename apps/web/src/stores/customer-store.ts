"use client";
import { create } from "zustand";

interface CustomerState {
  token: string | null;
  sessionId: string | null;
  branchSlug: string | null;
  tableCode: string | null;
  orderId: string | null;
  branchName: string | null;
  setSession: (data: {
    token: string;
    sessionId: string;
    branchSlug: string;
    tableCode: string;
    branchName?: string;
  }) => void;
  setOrderId: (orderId: string) => void;
  clear: () => void;
}

export const useCustomerStore = create<CustomerState>((set) => ({
  token: null,
  sessionId: null,
  branchSlug: null,
  tableCode: null,
  orderId: null,
  branchName: null,
  setSession: (data) => {
    set({
      token: data.token,
      sessionId: data.sessionId,
      branchSlug: data.branchSlug,
      tableCode: data.tableCode,
      branchName: data.branchName || null,
    });
    if (typeof window !== "undefined") {
      sessionStorage.setItem("customer_token", data.token);
      sessionStorage.setItem("customer_session_id", data.sessionId);
    }
  },
  setOrderId: (orderId) => {
    set({ orderId });
    if (typeof window !== "undefined") {
      sessionStorage.setItem("customer_order_id", orderId);
    }
  },
  clear: () => {
    set({
      token: null,
      sessionId: null,
      branchSlug: null,
      tableCode: null,
      orderId: null,
      branchName: null,
    });
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("customer_token");
      sessionStorage.removeItem("customer_session_id");
      sessionStorage.removeItem("customer_order_id");
    }
  },
}));
