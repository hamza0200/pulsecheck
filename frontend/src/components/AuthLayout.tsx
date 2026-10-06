import type { ReactNode } from 'react';
import { Brand, PulseTrace } from './Brand';

interface AuthLayoutProps {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Shared frame for the guest screens: chart paper, the pulse line, one form column. */
export function AuthLayout({ title, intro, children, footer }: AuthLayoutProps) {
  return (
    <div className="chart-paper min-h-dvh">
      <div className="px-5 pt-6 sm:px-10 lg:px-[12vw]">
        <Brand to="/login" />
      </div>
      <PulseTrace />
      <main className="px-5 pt-4 pb-16 sm:px-10 lg:px-[12vw]">
        <div className="max-w-sm">
          <h1 className="text-[2rem] leading-tight font-semibold tracking-tight">{title}</h1>
          {intro && <div className="mt-2 text-muted">{intro}</div>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 border-t border-grid pt-5 text-sm">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
