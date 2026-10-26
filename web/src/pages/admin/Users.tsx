import { KeyRound, Shield, ShieldOff, UserPlus, UserX, UserCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useToast } from '../../components/Toast.tsx';
import { Button, Card, Dialog, Field, Input, PageTitle, Select, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { ago, cx } from '../../lib/format.ts';
import { useFetch } from '../../lib/useFetch.ts';

type Row = { id: number; username: string; role: 'user' | 'admin'; disabled: number; created_at: string; ticket_count: number };

export function Users() {
  const { user: me } = useAuth();
  const notify = useToast();
  const { data, reload } = useFetch<Row[]>('/users');
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<Row | null>(null);

  const patch = async (u: Row, body: object, message: string) => {
    try {
      await api.patch(`/users/${u.id}`, body);
      notify(message);
      reload();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle
        title="Users"
        subtitle="Everyone who can sign in and send requests."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" /> Add user
          </Button>
        }
      />
      {!data ? (
        <Spinner />
      ) : (
        <Card className="divide-y divide-line">
          {data.map((u) => (
            <div key={u.id} className={cx('flex flex-wrap items-center gap-3 p-4', Boolean(u.disabled) && 'opacity-55')}>
              <div className="grid size-9 place-items-center rounded-full bg-surface-2 text-sm font-semibold uppercase">
                {u.username.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {u.username}
                  {u.id === me?.id && <span className="text-xs text-muted">(you)</span>}
                  {u.role === 'admin' && (
                    <span className="rounded bg-accent/20 px-1.5 text-[10px] font-semibold text-accent uppercase">admin</span>
                  )}
                  {u.disabled ? <span className="text-xs text-rose-500">disabled</span> : null}
                </div>
                <div className="text-xs text-muted">
                  {u.ticket_count} request{u.ticket_count === 1 ? '' : 's'} · joined {ago(u.created_at)}
                </div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setResetting(u)} title="Set a new password">
                  <KeyRound className="size-3.5" /> Password
                </Button>
                {u.id !== me?.id && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        patch(u, { role: u.role === 'admin' ? 'user' : 'admin' }, u.role === 'admin' ? `${u.username} is now a user` : `${u.username} is now an admin`)
                      }
                      title={u.role === 'admin' ? 'Make regular user' : 'Make admin'}
                    >
                      {u.role === 'admin' ? <ShieldOff className="size-3.5" /> : <Shield className="size-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => patch(u, { disabled: !u.disabled }, u.disabled ? `${u.username} can sign in again` : `${u.username} is disabled`)}
                      title={u.disabled ? 'Enable' : 'Disable'}
                    >
                      {u.disabled ? <UserCheck className="size-3.5" /> : <UserX className="size-3.5" />}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
      <AddUser open={adding} onClose={() => setAdding(false)} onDone={reload} />
      <ResetPassword user={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}

function AddUser({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const notify = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/users', { username, password, role });
      notify(`${username} can sign in now`);
      setUsername('');
      setPassword('');
      setRole('user');
      onDone();
      onClose();
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Add user">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Username">
          <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Password" hint="Share it with them; they can change it after signing in.">
          <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="user">User: sends requests</option>
            <option value="admin">Admin: manages everything</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Add user
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ResetPassword({ user, onClose }: { user: Row | null; onClose: () => void }) {
  const notify = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/users/${user!.id}`, { password });
      notify(`New password set for ${user!.username}`);
      setPassword('');
      onClose();
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(user)} onClose={onClose} title={`New password for ${user?.username ?? ''}`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password" hint="They will be signed out everywhere.">
          <Input autoFocus type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Set password
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
