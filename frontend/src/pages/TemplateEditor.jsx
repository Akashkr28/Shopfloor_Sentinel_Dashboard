import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import AlertCard from '../components/AlertCard.jsx';
import Icon, { ICON_NAMES } from '../components/Icon.jsx';
import { LANGS, t } from '../i18n.js';
import { useFetch } from '../session.jsx';

const PREDEFINED_KEYS = ['UNK_REMOTE_LOGIN', 'USB_INSERT', 'ABNORMAL_TRAFFIC', 'SUSPICIOUS_SOFTWARE', 'NEW_DEVICE', 'ROUTINE_CHECK', 'PLC_PROGRAM_CHANGE', 'FAILED_LOGIN_BURST', 'WIFI_ROGUE_AP'];
const FIELDS = [
  ['title', 'Title (short)', 1],
  ['whatYouSee', '1 · What you see', 2],
  ['whatToDo', '2 · What to do now', 3],
  ['whomToCall', '3 · Whom to call (role / phone)', 1],
];
const EMPTY_LOC = { title: '', whatYouSee: '', whatToDo: '', whomToCall: '' };

const blank = () => ({
  id: null, eventTypeKey: '', defaultSeverity: 'AMBER', iconName: 'alert', ownerFollowUp: '',
  localizations: Object.fromEntries(LANGS.map((l) => [l.code, { ...EMPTY_LOC }])),
});

const toDraft = (tpl) => ({
  ...tpl,
  ownerFollowUp: tpl.ownerFollowUp || '',
  localizations: Object.fromEntries(LANGS.map((l) => [l.code, { ...EMPTY_LOC, ...(tpl.localizations[l.code] || {}) }])),
});

function AudioControls({ templateId, lang, loc, saved, onChanged }) {
  const [recording, setRecording] = useState(false);
  const [msg, setMsg] = useState('');
  const recorder = useRef(null);
  const fileInput = useRef(null);

  const upload = async (blob) => {
    setMsg('Uploading…');
    try {
      await api(`/alert-templates/${templateId}/localizations/${lang}/audio`, {
        method: 'POST', body: blob, raw: true, headers: { 'Content-Type': blob.type.split(';')[0] || 'audio/webm' },
      });
      setMsg('Audio saved');
      onChanged();
    } catch (e) {
      setMsg(e.message);
    }
  };

  const record = async () => {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(false);
        upload(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      setMsg('Recording… read the 3 steps aloud, then press Stop');
    } catch {
      setMsg('Microphone not available – upload a file instead');
    }
  };

  if (!templateId || !saved) return <p className="muted small">Save the text for this language first, then add audio.</p>;
  return (
    <div className="audio-controls">
      {loc.audioUrl ? <audio controls src={loc.audioUrl} preload="none" /> : <span className="muted small">No recording – operators hear device text-to-speech.</span>}
      <div className="row gap-sm wrap">
        <button type="button" className={`btn ${recording ? 'btn-danger' : ''}`} onClick={record}>
          {recording ? 'Stop & save' : 'Record'}
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current.click()}>
          Upload file
        </button>
        {loc.audioUrl && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              await api(`/alert-templates/${templateId}/localizations/${lang}/audio`, { method: 'DELETE' });
              onChanged();
            }}
          >
            Remove
          </button>
        )}
        <input ref={fileInput} type="file" accept="audio/*" hidden onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
      </div>
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}

export default function TemplateEditor() {
  const templates = useFetch('/alert-templates');
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [tab, setTab] = useState('hi');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const list = templates.data || [];
  const selected = list.find((x) => x.id === selectedId);

  useEffect(() => {
    if (!draft && list.length) {
      setSelectedId(list[0].id);
      setDraft(toDraft(list[0]));
    }
  }, [list, draft]);

  const pick = (tpl) => {
    setSelectedId(tpl.id);
    setDraft(toDraft(tpl));
    setMsg(null);
  };
  const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setLoc = (field, v) => setDraft((d) => ({ ...d, localizations: { ...d.localizations, [tab]: { ...d.localizations[tab], [field]: v } } }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (!draft.localizations.en.title.trim()) throw new Error('English text is required – it is the fallback for every language.');
      const body = { eventTypeKey: draft.eventTypeKey, defaultSeverity: draft.defaultSeverity, iconName: draft.iconName, ownerFollowUp: draft.ownerFollowUp, localizations: draft.localizations };
      const savedTpl = draft.id
        ? await api(`/alert-templates/${draft.id}`, { method: 'PUT', body })
        : await api('/alert-templates', { method: 'POST', body });
      templates.reload();
      setSelectedId(savedTpl.id);
      setDraft(toDraft(savedTpl));
      setMsg({ ok: true, text: 'Saved. Operators see the new wording on the next alert.' });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const refreshAudio = async () => {
    const fresh = await api(`/alert-templates/${draft.id}`);
    templates.reload();
    setDraft((d) => ({ ...d, localizations: Object.fromEntries(LANGS.map((l) => [l.code, { ...d.localizations[l.code], audioUrl: fresh.localizations[l.code]?.audioUrl || null }])) }));
  };

  const preview = draft && {
    id: 0, severity: draft.defaultSeverity, status: 'OPEN', iconName: draft.iconName, isDrill: false, stepsDone: [],
    machineName: 'Press Line 1', timestamp: new Date().toISOString(), localizations: draft.localizations, eventTypeKey: draft.eventTypeKey,
  };
  const loc = draft?.localizations[tab];
  const savedLoc = selected?.localizations[tab];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Alert templates</h1>
          <p className="muted">What operators see and hear for each event – in every language.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setSelectedId(null);
            setDraft(blank());
            setTab('en');
            setMsg(null);
          }}
        >
          + New template
        </button>
      </div>

      <div className="editor">
        <aside className="tpl-list">
          {list.map((tpl) => (
            <button key={tpl.id} className={`tpl-item ${tpl.id === selectedId ? 'active' : ''}`} onClick={() => pick(tpl)}>
              <span className={`tpl-icon sev-bg-${tpl.defaultSeverity}`}>
                <Icon name={tpl.iconName} size={22} />
              </span>
              <span>
                <span className="mono small">{tpl.eventTypeKey}</span>
                <br />
                {tpl.localizations.en?.title}
                <span className="lang-badges">
                  {LANGS.map((l) => (
                    <span key={l.code} className={tpl.localizations[l.code] ? 'on' : ''} title={l.label}>
                      {l.code}
                      {tpl.localizations[l.code]?.audioUrl ? '♪' : ''}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          ))}
        </aside>

        {draft && (
          <section className="panel tpl-form">
            <div className="grid-2">
              <label>
                Event type key
                {draft.id ? (
                  <input value={draft.eventTypeKey} disabled />
                ) : (
                  <>
                    <input list="event-keys" value={draft.eventTypeKey} onChange={(e) => setField('eventTypeKey', e.target.value.toUpperCase())} placeholder="e.g. PLC_PROGRAM_CHANGE" />
                    <datalist id="event-keys">
                      {PREDEFINED_KEYS.filter((k) => !list.some((x) => x.eventTypeKey === k)).map((k) => (
                        <option key={k} value={k} />
                      ))}
                    </datalist>
                  </>
                )}
              </label>
              <label>
                Default severity
                <div className="sev-picker">
                  {['GREEN', 'AMBER', 'RED'].map((s) => (
                    <button type="button" key={s} className={`sev-opt sev-bg-${s} ${draft.defaultSeverity === s ? 'active' : ''}`} onClick={() => setField('defaultSeverity', s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </label>
            </div>

            <label>Icon</label>
            <div className="icon-picker">
              {ICON_NAMES.map((n) => (
                <button type="button" key={n} className={draft.iconName === n ? 'active' : ''} onClick={() => setField('iconName', n)} title={n}>
                  <Icon name={n} size={26} />
                </button>
              ))}
            </div>

            <label>
              Owner follow-up (sent in WhatsApp for red alerts)
              <input value={draft.ownerFollowUp} onChange={(e) => setField('ownerFollowUp', e.target.value)} />
            </label>

            <div className="lang-switch" role="tablist">
              {LANGS.map((l) => (
                <button type="button" key={l.code} role="tab" aria-selected={tab === l.code} className={tab === l.code ? 'active' : ''} onClick={() => setTab(l.code)}>
                  {l.label}
                  {!draft.localizations[l.code].title && <span className="missing">•</span>}
                </button>
              ))}
            </div>

            {FIELDS.map(([field, label, rows]) => (
              <label key={field}>
                {label}
                {rows > 1 ? (
                  <textarea rows={rows} value={loc[field]} onChange={(e) => setLoc(field, e.target.value)} lang={tab} />
                ) : (
                  <input value={loc[field]} onChange={(e) => setLoc(field, e.target.value)} lang={tab} />
                )}
              </label>
            ))}
            {tab !== 'en' && !loc.title && <p className="muted small">Leave empty to fall back to English for this language.</p>}

            <label>Audio ({LANGS.find((l) => l.code === tab).label})</label>
            <AudioControls templateId={draft.id} lang={tab} loc={loc} saved={!!savedLoc} onChanged={refreshAudio} />

            <div className="row gap-sm wrap save-row">
              <button className="btn btn-primary btn-lg" onClick={save} disabled={busy || !draft.eventTypeKey}>
                {busy ? 'Saving…' : 'Save template'}
              </button>
              {msg && <span className={msg.ok ? 'ok' : 'error'}>{msg.text}</span>}
            </div>
          </section>
        )}

        {preview && (
          <aside className="preview">
            <h3>Operator preview · {LANGS.find((l) => l.code === tab).label}</h3>
            <AlertCard alert={preview} lang={tab} onOpen={() => {}} />
            <ol className="steps compact">
              {[['whatYouSee', 'eye'], ['whatToDo', 'hand'], ['whomToCall', 'phone']].map(([f, icon], i) => (
                <li key={f} className="step">
                  <div className="step-num">{i + 1}</div>
                  <div className="step-body">
                    <div className="step-label">
                      <Icon name={icon} size={16} /> {t(tab, f)}
                    </div>
                    <p className="step-text">{(loc[f] || draft.localizations.en[f]) || '…'}</p>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        )}
      </div>
    </div>
  );
}
