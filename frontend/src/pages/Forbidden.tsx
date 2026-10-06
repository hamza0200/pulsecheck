import { Link } from 'react-router';

export function Forbidden() {
  return (
    <div className="max-w-lg py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Admins only</h1>
      <p className="mt-2 text-muted">
        This area is for PulseCheck administrators. Your account doesn&apos;t have access.
      </p>
      <Link
        to="/dashboard"
        className="mt-6 inline-block font-semibold underline underline-offset-4"
      >
        Back to your dashboard
      </Link>
    </div>
  );
}
