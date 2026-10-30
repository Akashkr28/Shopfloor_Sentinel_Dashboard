import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import Modal from './Modal.jsx';

/** Change your own password. Signs out every other session of this account. */
export default function AccountDialog({ onClose }) {
  const { user } = useSession();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [state, setState] = useState({ busy: false, error: '', done: false });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (f.newPassword !== f.confirm) return setState({ error: 'The new passwords do not match' });
    setState({ busy: true });
    try {
      await api('/me/password', { method: 'POST', body: { currentPassword: f.currentPassword, newPassword: f.newPassword } });
      setState({ done: true });
    } catch (err) {
      setState({ error: err.message });
    }
  };

  return (
    <Modal title="Your account" onClose={onClose}>
      <p className="muted small">
        {user.name} · <span className="mono">{user.username}</span> · {user.role.toLowerCase()}
      </p>
      {state.done ? (
        <>
          <p className="ok">Password changed. Other devices using this account have been signed out.</p>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </>
      ) : (
        <form onSubmit={submit}>
          <label>
            Current password
            <input type="password" value={f.currentPassword} onChange={set('currentPassword')} autoComplete="current-password" required />
          </label>
          <label>
            New password (8+ characters)
            <input type="password" value={f.newPassword} onChange={set('newPassword')} autoComplete="new-password" minLength={8} required />
          </label>
          <label>
            Repeat new password
            <input type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" minLength={8} required />
          </label>
          {state.error && <p className="error small">{state.error}</p>}
          <button className="btn btn-primary" disabled={state.busy}>
            {state.busy ? 'Saving…' : 'Change password'}
          </button>
        </form>
      )}
    </Modal>
  );
}
