import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useCreateMonitor, useMonitor, useUpdateMonitor } from '../api/monitors';
import { Button, FormAlert, TextField } from '../components/forms';
import { ErrorState, Spinner } from '../components/PageState';
import { validateInterval, validateMonitorUrl, validateTimeout } from '../lib/validation';

interface Fields {
  name: string;
  url: string;
  intervalMinutes: string;
  timeoutMs: string;
}
type Errors = Partial<Record<keyof Fields, string>>;

function validate(f: Fields): Errors {
  return {
    name: f.name.trim().length > 100 ? 'Name is too long' : undefined,
    url: validateMonitorUrl(f.url),
    intervalMinutes: validateInterval(f.intervalMinutes),
    timeoutMs: validateTimeout(f.timeoutMs),
  };
}

function suggestedName(url: string): string {
  try {
    return new URL(url.trim()).hostname.replace(/^www\./, '');
  } catch {
    return 'example.com';
  }
}

/** Create (/monitors/new) and edit (/monitors/:id/edit) share this form. */
export function MonitorForm() {
  const { id } = useParams();
  return id ? <EditMonitor id={id} /> : <MonitorFields mode="create" />;
}

function EditMonitor({ id }: { id: string }) {
  const { data, isPending, isError, error, refetch } = useMonitor(id);
  if (isPending) return <Spinner label="Loading monitor" />;
  if (isError) {
    return (
      <ErrorState
        title={error instanceof ApiError && error.status === 404 ? 'Monitor not found' : undefined}
        message={error instanceof ApiError ? error.message : 'The monitor could not be loaded.'}
        onRetry={() => void refetch()}
      />
    );
  }
  return (
    <MonitorFields
      key={data.id}
      mode="edit"
      id={id}
      initial={{
        name: data.name,
        url: data.url,
        intervalMinutes: String(data.intervalMinutes),
        timeoutMs: String(data.timeoutMs),
      }}
    />
  );
}

function MonitorFields({
  mode,
  id,
  initial = { name: '', url: '', intervalMinutes: '10', timeoutMs: '10000' },
}: {
  mode: 'create' | 'edit';
  id?: string;
  initial?: Fields;
}) {
  const navigate = useNavigate();
  const create = useCreateMonitor();
  const update = useUpdateMonitor();
  const [fields, setFields] = useState<Fields>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  function set(name: keyof Fields, value: string) {
    const next = { ...fields, [name]: value };
    setFields(next);
    if (submitted) setErrors(validate(next));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    const found = validate(fields);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    const input = {
      url: fields.url.trim(),
      intervalMinutes: Number(fields.intervalMinutes),
      timeoutMs: Number(fields.timeoutMs),
      ...(fields.name.trim() ? { name: fields.name.trim() } : {}),
    };
    try {
      const monitor =
        mode === 'create'
          ? await create.mutateAsync(input)
          : await update.mutateAsync({ id: id!, ...input });
      navigate(`/monitors/${monitor.id}`);
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setServerError('Something went wrong. Try again.');
        return;
      }
      // SSRF and validation errors come back per field; duplicates and limits don't.
      const fe = err.fieldErrors;
      if (Object.keys(fe).length > 0) {
        setErrors({
          name: fe.name?.[0],
          url: fe.url?.[0],
          intervalMinutes: fe.intervalMinutes?.[0],
          timeoutMs: fe.timeoutMs?.[0],
        });
      } else if (err.code === 'MONITOR_EXISTS') {
        setErrors({ url: err.message });
      } else {
        setServerError(err.message);
      }
    }
  }

  const title = mode === 'create' ? 'Add a monitor' : 'Edit monitor';
  const cancelTo = mode === 'create' ? '/dashboard' : `/monitors/${id}`;

  return (
    <div className="max-w-xl">
      <h1 className="text-[2rem] leading-tight font-semibold tracking-tight">{title}</h1>
      {mode === 'create' && (
        <p className="mt-2 text-muted">
          PulseCheck sends a GET request on your schedule and records whether the site answered.
        </p>
      )}
      <form noValidate onSubmit={handleSubmit} className="mt-8 space-y-5">
        {serverError && <FormAlert>{serverError}</FormAlert>}
        <TextField
          label="URL"
          name="url"
          type="url"
          inputMode="url"
          placeholder="https://example.com"
          autoComplete="off"
          value={fields.url}
          error={errors.url}
          hint="http:// or https:// on the standard ports. Private and local addresses are refused."
          onChange={(e) => set('url', e.target.value)}
        />
        <TextField
          label="Name (optional)"
          name="name"
          placeholder={suggestedName(fields.url)}
          value={fields.name}
          error={errors.name}
          hint="Leave empty to use the hostname."
          onChange={(e) => set('name', e.target.value)}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Check every (minutes)"
            name="intervalMinutes"
            type="number"
            min={5}
            max={1440}
            step={1}
            value={fields.intervalMinutes}
            error={errors.intervalMinutes}
            hint="5 minutes minimum, to be polite to the site."
            onChange={(e) => set('intervalMinutes', e.target.value)}
          />
          <TextField
            label="Timeout (ms)"
            name="timeoutMs"
            type="number"
            min={1000}
            max={30000}
            step={500}
            value={fields.timeoutMs}
            error={errors.timeoutMs}
            hint="Slower responses count as down."
            onChange={(e) => set('timeoutMs', e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Button
            type="submit"
            pending={pending}
            pendingLabel={mode === 'create' ? 'Adding…' : 'Saving…'}
          >
            {mode === 'create' ? 'Add monitor' : 'Save changes'}
          </Button>
          <Link
            to={cancelTo}
            className="rounded-md px-4 py-2 text-sm font-semibold hover:bg-grid/60"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
