import { createFileRoute } from "@tanstack/react-router";
import { LedgerApp } from "@/components/ledger/ledger-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <LedgerApp />;
}
