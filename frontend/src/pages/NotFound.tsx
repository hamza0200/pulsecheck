import { Link } from 'react-router';
import { Brand, PulseTrace } from '../components/Brand';

export function NotFound() {
  return (
    <div className="chart-paper min-h-dvh">
      <div className="px-5 pt-6 sm:px-10 lg:px-[12vw]">
        <Brand />
      </div>
      <PulseTrace />
      <main className="px-5 pt-4 sm:px-10 lg:px-[12vw]">
        <h1 className="text-[2rem] font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 max-w-md text-muted">
          There&apos;s nothing at this address. It may have moved, or the link may be mistyped.
        </p>
        <Link to="/" className="mt-6 inline-block font-semibold underline underline-offset-4">
          Go to your dashboard
        </Link>
      </main>
    </div>
  );
}
