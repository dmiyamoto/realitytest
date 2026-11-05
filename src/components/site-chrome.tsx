import Link from "next/link";
import { GITHUB_URL } from "@/lib/site";
import { BillingGate } from "./billing-gate";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
        <path d="M7 12.5l3 3 7-7.5" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>
        Reality<span className="text-accent">Test</span>
      </span>
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="RealityTest home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <Link href="/evaluate" className="rounded-md px-3 py-1.5 text-muted hover:bg-panel-2 hover:text-fg">
            Evaluate
          </Link>
          <BillingGate
            on={
              <Link href="/pricing" className="rounded-md px-3 py-1.5 text-muted hover:bg-panel-2 hover:text-fg">
                Pricing
              </Link>
            }
          />
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hidden rounded-md px-3 py-1.5 text-muted hover:bg-panel-2 hover:text-fg sm:inline">
            GitHub
          </a>
          <Link href="/evaluate" className="ml-1 rounded-md bg-accent px-3 py-1.5 font-medium text-black hover:brightness-110">
            Try demo
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>RealityTest · MIT licensed · Built with Meta SAM 3.1 via the Meta Model API</span>
        <span>2D visual evidence only — not a safety certification or proof of 3D contact.</span>
      </div>
    </footer>
  );
}
