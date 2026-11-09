"use client";

// The desk's "attention" figure (low stock + EFT awaiting approval + open
// disputes) is counted once — by the dashboard, which already loads all three
// sources for its KPI cards — and reported up to the shell so the header bell
// and the "Needs attention" card can never disagree. The layout owns the
// shell, so it also owns the state; pages push their count into it.
import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

export type ReportAttention = (count: number) => void;

const AttentionContext = createContext<ReportAttention>(() => {});

export function AttentionProvider({
  report,
  children,
}: {
  report: ReportAttention;
  children: ReactNode;
}) {
  return (
    <AttentionContext.Provider value={report}>
      {children}
    </AttentionContext.Provider>
  );
}

export function useReportAttention(): ReportAttention {
  return useContext(AttentionContext);
}
