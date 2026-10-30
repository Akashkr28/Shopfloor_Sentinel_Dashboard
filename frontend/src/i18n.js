// UI chrome strings. Operator scripts themselves come from the backend templates.
export const LANGS = [
  { code: 'hi', label: 'हिन्दी', speech: 'hi-IN' },
  { code: 'mr', label: 'मराठी', speech: 'mr-IN' },
  { code: 'ta', label: 'தமிழ்', speech: 'ta-IN' },
  { code: 'en', label: 'English', speech: 'en-IN' },
];

const S = {
  en: {
    whatYouSee: 'What you see', whatToDo: 'What to do now', whomToCall: 'Whom to call',
    iDidThis: 'I did this', done: 'Done', activeOnly: 'Active only', all: 'All', listen: 'Listen', stop: 'Stop',
    drill: 'DRILL', practice: 'Practice drill – follow the steps as if it were real',
    allClear: 'All clear', allClearSub: 'No security alerts right now. Keep working normally.',
    RED: 'Danger', AMBER: 'Warning', GREEN: 'OK', OPEN: 'New', ACKNOWLEDGED: 'Seen', RESOLVED: 'Handled',
    close: 'Close', allStepsDone: 'All steps done – thank you!', logout: 'Log out', live: 'Live', offline: 'Reconnecting…',
    noTranslation: 'Not translated yet – showing English',
  },
  hi: {
    whatYouSee: 'आपको क्या दिख रहा है', whatToDo: 'अभी क्या करें', whomToCall: 'किसे फ़ोन करें',
    iDidThis: 'मैंने यह किया', done: 'हो गया', activeOnly: 'सिर्फ़ चालू', all: 'सभी', listen: 'सुनें', stop: 'रोकें',
    drill: 'अभ्यास', practice: 'अभ्यास ड्रिल – इसे असली मानकर कदम पूरे करें',
    allClear: 'सब ठीक है', allClearSub: 'अभी कोई सुरक्षा चेतावनी नहीं। सामान्य काम करते रहें।',
    RED: 'खतरा', AMBER: 'चेतावनी', GREEN: 'ठीक', OPEN: 'नया', ACKNOWLEDGED: 'देखा', RESOLVED: 'संभाला',
    close: 'बंद करें', allStepsDone: 'सभी कदम पूरे – धन्यवाद!', logout: 'लॉग आउट', live: 'चालू', offline: 'जुड़ रहा है…',
    noTranslation: 'अनुवाद नहीं है – अंग्रेज़ी दिखा रहे हैं',
  },
  mr: {
    whatYouSee: 'तुम्हाला काय दिसते', whatToDo: 'आता काय करायचे', whomToCall: 'कोणाला फोन करायचा',
    iDidThis: 'मी हे केले', done: 'झाले', activeOnly: 'फक्त चालू', all: 'सर्व', listen: 'ऐका', stop: 'थांबवा',
    drill: 'सराव', practice: 'सराव ड्रिल – खरे समजून पायऱ्या पूर्ण करा',
    allClear: 'सर्व ठीक आहे', allClearSub: 'सध्या कोणताही सुरक्षा इशारा नाही. नेहमीचे काम चालू ठेवा.',
    RED: 'धोका', AMBER: 'सावधान', GREEN: 'ठीक', OPEN: 'नवीन', ACKNOWLEDGED: 'पाहिले', RESOLVED: 'हाताळले',
    close: 'बंद करा', allStepsDone: 'सर्व पायऱ्या पूर्ण – धन्यवाद!', logout: 'लॉग आउट', live: 'चालू', offline: 'जोडत आहे…',
    noTranslation: 'भाषांतर नाही – इंग्रजी दाखवत आहे',
  },
  ta: {
    whatYouSee: 'நீங்கள் பார்ப்பது', whatToDo: 'இப்போது செய்ய வேண்டியது', whomToCall: 'யாரை அழைக்க வேண்டும்',
    iDidThis: 'நான் இதைச் செய்தேன்', done: 'முடிந்தது', activeOnly: 'செயலில் உள்ளவை', all: 'அனைத்தும்', listen: 'கேளுங்கள்', stop: 'நிறுத்து',
    drill: 'பயிற்சி', practice: 'பயிற்சி – உண்மையானது போல் படிகளைப் பின்பற்றவும்',
    allClear: 'எல்லாம் சரி', allClearSub: 'இப்போது பாதுகாப்பு எச்சரிக்கை இல்லை. வழக்கம் போல் வேலை செய்யுங்கள்.',
    RED: 'ஆபத்து', AMBER: 'எச்சரிக்கை', GREEN: 'சரி', OPEN: 'புதியது', ACKNOWLEDGED: 'பார்த்தது', RESOLVED: 'கையாளப்பட்டது',
    close: 'மூடு', allStepsDone: 'எல்லா படிகளும் முடிந்தன – நன்றி!', logout: 'வெளியேறு', live: 'நேரலை', offline: 'இணைக்கிறது…',
    noTranslation: 'மொழிபெயர்ப்பு இல்லை – ஆங்கிலம் காட்டப்படுகிறது',
  },
};

export const t = (lang, key) => S[lang]?.[key] ?? S.en[key] ?? key;

export function timeAgo(iso, lang = 'en') {
  const secs = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const abs = Math.abs(secs);
  if (abs < 60) return rtf.format(secs, 'second');
  if (abs < 3600) return rtf.format(Math.round(secs / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), 'hour');
  return rtf.format(Math.round(secs / 86400), 'day');
}

/** Pick the localization for `lang`, falling back to English then anything available. */
export function pickLoc(localizations = {}, lang) {
  const loc = localizations[lang] || localizations.en || Object.values(localizations)[0] || null;
  return { loc, fallback: !!loc && !localizations[lang] };
}

export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
