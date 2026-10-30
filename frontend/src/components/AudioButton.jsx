import { useEffect, useRef, useState } from 'react';
import { LANGS, t } from '../i18n.js';
import Icon from './Icon.jsx';

/**
 * Plays the engineer-recorded audio for this language if there is one;
 * otherwise reads the script aloud with the phone/TV's own text-to-speech.
 */
export default function AudioButton({ audioUrl, text, lang, uiLang = lang, big = false }) {
  const [playing, setPlaying] = useState(false);
  const audio = useRef(null);
  const speechLang = LANGS.find((l) => l.code === lang)?.speech || 'en-IN';
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const stop = () => {
    audio.current?.pause();
    if (canSpeak) window.speechSynthesis.cancel();
    setPlaying(false);
  };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  const play = () => {
    stop();
    if (audioUrl) {
      audio.current = new Audio(audioUrl);
      audio.current.onended = () => setPlaying(false);
      audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      return;
    }
    if (!canSpeak) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.replace('_', '-').startsWith(lang));
    if (voice) u.voice = voice;
    u.rate = 0.9;
    u.onend = () => setPlaying(false);
    u.onerror = () => setPlaying(false);
    window.speechSynthesis.speak(u);
    setPlaying(true);
  };

  if (!audioUrl && !canSpeak) return null;
  return (
    <button type="button" className={`btn audio ${big ? 'btn-lg' : ''} ${playing ? 'playing' : ''}`} onClick={playing ? stop : play}>
      <Icon name="speaker" size={big ? 28 : 20} />
      {playing ? t(uiLang, 'stop') : t(uiLang, 'listen')}
      {!audioUrl && <span className="muted small"> (TTS)</span>}
    </button>
  );
}
