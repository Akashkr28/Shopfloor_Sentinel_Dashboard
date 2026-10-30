// Demo users, machines and alert templates. Scripts are deliberately short and
// plain so a shopfloor operator can follow them in under a minute.

export const users = [
  { username: 'owner', name: 'Suresh Patil', role: 'OWNER', preferredLanguage: 'en', phoneNumber: '+919000000100' },
  { username: 'engineer', name: 'Ramesh Kumar', role: 'ENGINEER', preferredLanguage: 'en', phoneNumber: '+919000000201' },
  { username: 'supervisor', name: 'Lakshmi Iyer', role: 'SUPERVISOR', preferredLanguage: 'ta', phoneNumber: '+919000000301' },
  { username: 'operator', name: 'Ravi Yadav', role: 'OPERATOR', preferredLanguage: 'hi', phoneNumber: null },
  { username: 'operator2', name: 'Ganesh Shinde', role: 'OPERATOR', preferredLanguage: 'mr', phoneNumber: null },
];
// Every demo account uses this password; see README.
export const DEMO_PASSWORD = 'sentinel123';

export const machines = [
  { name: 'Press Line 1', location: 'Shed A', identifier: 'PRESS_LINE_1_HMI' },
  { name: 'Press Line 2', location: 'Shed A', identifier: 'PRESS_LINE_2_HMI' },
  { name: 'CNC Cell 3', location: 'Shed B', identifier: 'CNC_CELL_3_PC' },
  { name: 'Packaging HMI A', location: 'Dispatch', identifier: 'PACKAGING_HMI_A' },
  { name: 'Office Network', location: 'Admin block', identifier: 'OFFICE_LAN' },
];

const ENGINEER = '+91 90000 00201';
const IT = '+91 90000 00202';

export const templates = [
  {
    eventTypeKey: 'UNK_REMOTE_LOGIN',
    defaultSeverity: 'AMBER',
    iconName: 'remote',
    ownerFollowUp: 'Ask the engineer who has remote access (AnyDesk/TeamViewer/SSH) and change those passwords today.',
    loc: {
      en: ['Unknown remote login', 'The mouse moves by itself, or a "Remote session" box appears on the HMI / PC.', 'Do not touch mouse or keyboard. Only if the machine is safely stopped, pull the HMI network cable. Note the time.', `Call Maintenance Engineer: ${ENGINEER}`],
      hi: ['अनजान रिमोट लॉगिन', 'HMI / कंप्यूटर पर माउस अपने आप चल रहा है, या "Remote session" का बॉक्स दिख रहा है।', 'माउस या कीबोर्ड को न छुएँ। मशीन सुरक्षित रूप से रुकी हो तभी HMI का नेटवर्क केबल निकालें। समय लिख लें।', `मेंटेनेंस इंजीनियर को फ़ोन करें: ${ENGINEER}`],
      mr: ['अनोळखी रिमोट लॉगिन', 'HMI / संगणकावर माउस आपोआप हलत आहे, किंवा "Remote session" चा बॉक्स दिसत आहे.', 'माउस किंवा कीबोर्डला हात लावू नका. मशीन सुरक्षितपणे थांबलेली असेल तरच HMI ची नेटवर्क केबल काढा. वेळ लिहून ठेवा.', `मेंटेनन्स इंजिनिअरला फोन करा: ${ENGINEER}`],
      ta: ['தெரியாத தொலை உள்நுழைவு', 'HMI / கணினியில் மவுஸ் தானாக நகர்கிறது, அல்லது "Remote session" பெட்டி தெரிகிறது.', 'மவுஸ் அல்லது கீபோர்டைத் தொடாதீர்கள். இயந்திரம் பாதுகாப்பாக நின்றிருந்தால் மட்டும் HMI நெட்வொர்க் கேபிளை எடுக்கவும். நேரத்தைக் குறித்துக்கொள்ளுங்கள்.', `பராமரிப்பு பொறியாளரை அழைக்கவும்: ${ENGINEER}`],
    },
  },
  {
    eventTypeKey: 'USB_INSERT',
    defaultSeverity: 'RED',
    iconName: 'usb',
    ownerFollowUp: 'Find out who brought the USB drive and remind all shifts of the no-USB rule on machines.',
    loc: {
      en: ['USB drive plugged into machine', 'A pen drive / USB stick is plugged into the HMI or machine PC.', 'Do not open any file. Gently remove the USB drive and put it in the supervisor box. Do not use it on another machine.', `Call Maintenance Engineer: ${ENGINEER}`],
      hi: ['मशीन में USB पेन ड्राइव लगी है', 'HMI या मशीन के कंप्यूटर में पेन ड्राइव / USB लगी हुई है।', 'कोई भी फ़ाइल न खोलें। USB को धीरे से निकालें और सुपरवाइज़र के डिब्बे में रखें। किसी दूसरी मशीन में न लगाएँ।', `मेंटेनेंस इंजीनियर को फ़ोन करें: ${ENGINEER}`],
      mr: ['मशीनमध्ये USB पेन ड्राइव्ह लावला आहे', 'HMI किंवा मशीनच्या संगणकात पेन ड्राइव्ह / USB लावलेला आहे.', 'कोणतीही फाइल उघडू नका. USB हळूच काढा आणि सुपरवायझरच्या डब्यात ठेवा. दुसऱ्या मशीनला लावू नका.', `मेंटेनन्स इंजिनिअरला फोन करा: ${ENGINEER}`],
      ta: ['இயந்திரத்தில் USB பென் டிரைவ் செருகப்பட்டுள்ளது', 'HMI அல்லது இயந்திரக் கணினியில் பென் டிரைவ் / USB செருகப்பட்டுள்ளது.', 'எந்தக் கோப்பையும் திறக்காதீர்கள். USB-ஐ மெதுவாக எடுத்து மேற்பார்வையாளர் பெட்டியில் வைக்கவும். வேறு இயந்திரத்தில் பயன்படுத்தாதீர்கள்.', `பராமரிப்பு பொறியாளரை அழைக்கவும்: ${ENGINEER}`],
    },
  },
  {
    eventTypeKey: 'ABNORMAL_TRAFFIC',
    defaultSeverity: 'AMBER',
    iconName: 'network',
    ownerFollowUp: 'Ask IT which device is sending data outside the factory and block it if nobody recognises it.',
    loc: {
      en: ['Unusual network activity', 'The machine screen is slow or freezing, or the network light blinks non-stop.', 'Keep running only if it is safe. Do not restart the PC. Write down what is on the screen.', `Call IT / Engineer: ${IT}`],
      hi: ['नेटवर्क में असामान्य गतिविधि', 'मशीन की स्क्रीन धीमी है या अटक रही है, या नेटवर्क लाइट लगातार झपक रही है।', 'सुरक्षित हो तभी मशीन चलाते रहें। कंप्यूटर रीस्टार्ट न करें। स्क्रीन पर जो दिख रहा है वह लिख लें।', `IT / इंजीनियर को फ़ोन करें: ${IT}`],
      mr: ['नेटवर्कमध्ये असामान्य हालचाल', 'मशीनची स्क्रीन हळू चालत आहे किंवा अडकत आहे, किंवा नेटवर्क लाइट सतत लुकलुकत आहे.', 'सुरक्षित असेल तरच मशीन चालू ठेवा. संगणक रीस्टार्ट करू नका. स्क्रीनवर जे दिसते ते लिहून ठेवा.', `IT / इंजिनिअरला फोन करा: ${IT}`],
      ta: ['அசாதாரண நெட்வொர்க் செயல்பாடு', 'இயந்திரத் திரை மெதுவாக உள்ளது அல்லது உறைகிறது, அல்லது நெட்வொர்க் விளக்கு தொடர்ந்து மின்னுகிறது.', 'பாதுகாப்பாக இருந்தால் மட்டும் இயக்கவும். கணினியை மறுதொடக்கம் செய்யாதீர்கள். திரையில் தெரிவதை எழுதி வையுங்கள்.', `IT / பொறியாளரை அழைக்கவும்: ${IT}`],
    },
  },
  {
    eventTypeKey: 'SUSPICIOUS_SOFTWARE',
    defaultSeverity: 'RED',
    iconName: 'bug',
    ownerFollowUp: 'Keep the machine isolated, call your IT vendor today and confirm backups are safe.',
    loc: {
      en: ['Suspicious software on machine', 'A new program, pop-up, or a message asking for money / password appears on the HMI or PC.', 'Do not click anything. Take a photo of the screen with your phone. If the HMI stops responding, stop the machine safely.', `Call Engineer and Supervisor: ${ENGINEER}`],
      hi: ['मशीन पर संदिग्ध सॉफ़्टवेयर', 'HMI या कंप्यूटर पर नया प्रोग्राम, पॉप-अप, या पैसे / पासवर्ड माँगने वाला संदेश दिख रहा है।', 'कुछ भी क्लिक न करें। फ़ोन से स्क्रीन की फ़ोटो लें। HMI जवाब न दे तो मशीन को सुरक्षित तरीके से रोकें।', `इंजीनियर और सुपरवाइज़र को फ़ोन करें: ${ENGINEER}`],
      mr: ['मशीनवर संशयास्पद सॉफ्टवेअर', 'HMI किंवा संगणकावर नवीन प्रोग्राम, पॉप-अप, किंवा पैसे / पासवर्ड मागणारा संदेश दिसत आहे.', 'काहीही क्लिक करू नका. फोनने स्क्रीनचा फोटो काढा. HMI प्रतिसाद देत नसेल तर मशीन सुरक्षितपणे थांबवा.', `इंजिनिअर आणि सुपरवायझरला फोन करा: ${ENGINEER}`],
      ta: ['இயந்திரத்தில் சந்தேகமான மென்பொருள்', 'HMI அல்லது கணினியில் புதிய நிரல், பாப்-அப், அல்லது பணம் / கடவுச்சொல் கேட்கும் செய்தி தெரிகிறது.', 'எதையும் கிளிக் செய்யாதீர்கள். உங்கள் போனில் திரையைப் புகைப்படம் எடுங்கள். HMI பதிலளிக்காவிட்டால் இயந்திரத்தைப் பாதுகாப்பாக நிறுத்தவும்.', `பொறியாளர் மற்றும் மேற்பார்வையாளரை அழைக்கவும்: ${ENGINEER}`],
    },
  },
  {
    eventTypeKey: 'NEW_DEVICE',
    defaultSeverity: 'AMBER',
    iconName: 'device',
    ownerFollowUp: 'Check that the new device belongs to staff or an approved vendor.',
    loc: {
      en: ['New device on the network', 'Someone connected a new laptop, phone or Wi-Fi box near the machine.', 'Ask who connected it. Do not unplug machine cables. Note the device and the person\'s name.', `Inform Supervisor / IT: ${IT}`],
      hi: ['नेटवर्क से नया उपकरण जुड़ा', 'मशीन के पास किसी ने नया लैपटॉप, फ़ोन या वाई-फ़ाई डिब्बा जोड़ा है।', 'पूछें किसने जोड़ा। मशीन के केबल न निकालें। उपकरण और व्यक्ति का नाम लिख लें।', `सुपरवाइज़र / IT को बताएँ: ${IT}`],
      mr: ['नेटवर्कला नवीन उपकरण जोडले', 'मशीनजवळ कोणीतरी नवीन लॅपटॉप, फोन किंवा वाय-फाय डबा जोडला आहे.', 'कोणी जोडले ते विचारा. मशीनच्या केबल काढू नका. उपकरण आणि व्यक्तीचे नाव लिहून ठेवा.', `सुपरवायझर / IT ला कळवा: ${IT}`],
      ta: ['நெட்வொர்க்கில் புதிய சாதனம்', 'இயந்திரத்தின் அருகே யாரோ புதிய லேப்டாப், போன் அல்லது வைஃபை பெட்டியை இணைத்துள்ளனர்.', 'யார் இணைத்தார்கள் என்று கேளுங்கள். இயந்திரக் கேபிள்களை எடுக்காதீர்கள். சாதனம் மற்றும் நபரின் பெயரைக் குறித்துக்கொள்ளுங்கள்.', `மேற்பார்வையாளர் / IT-க்குத் தெரிவிக்கவும்: ${IT}`],
    },
  },
  {
    eventTypeKey: 'ROUTINE_CHECK',
    defaultSeverity: 'GREEN',
    iconName: 'shield',
    ownerFollowUp: 'No action needed.',
    loc: {
      en: ['Routine security check passed', 'Nothing unusual. The gateway checked this machine.', 'Continue normal work.', 'No call needed.'],
      hi: ['नियमित सुरक्षा जाँच ठीक है', 'कुछ भी असामान्य नहीं। गेटवे ने इस मशीन की जाँच की।', 'सामान्य काम जारी रखें।', 'फ़ोन करने की ज़रूरत नहीं।'],
      mr: ['नियमित सुरक्षा तपासणी ठीक आहे', 'काहीही असामान्य नाही. गेटवेने या मशीनची तपासणी केली.', 'नेहमीचे काम चालू ठेवा.', 'फोन करण्याची गरज नाही.'],
      ta: ['வழக்கமான பாதுகாப்பு சோதனை சரி', 'அசாதாரணமாக எதுவும் இல்லை. கேட்வே இந்த இயந்திரத்தைச் சோதித்தது.', 'வழக்கமான வேலையைத் தொடருங்கள்.', 'அழைக்க வேண்டியதில்லை.'],
    },
  },
  {
    // Raised by net_monitor.py when a Modbus/TCP write reaches a PLC from a computer that isn't an engineering station.
    eventTypeKey: 'PLC_WRITE',
    defaultSeverity: 'RED',
    iconName: 'lock',
    ownerFollowUp: 'Ask the engineer to confirm who changed the PLC program or settings and compare with the last known-good backup.',
    loc: {
      en: ['Machine program or settings changed', 'The machine behaves differently, a recipe / setpoint changed, or the HMI shows "download" or "program changed".', 'If the machine behaves strangely, stop it safely. Do not change anything back yourself. Write down what changed.', `Call Maintenance Engineer now: ${ENGINEER}`],
      hi: ['मशीन का प्रोग्राम या सेटिंग बदली गई', 'मशीन अलग तरह से चल रही है, रेसिपी / सेटपॉइंट बदल गया है, या HMI पर "download" या "program changed" दिख रहा है।', 'मशीन अजीब चले तो उसे सुरक्षित तरीके से रोकें। खुद कुछ भी वापस न बदलें। क्या बदला, वह लिख लें।', `अभी मेंटेनेंस इंजीनियर को फ़ोन करें: ${ENGINEER}`],
      mr: ['मशीनचा प्रोग्राम किंवा सेटिंग बदलली', 'मशीन वेगळ्या पद्धतीने चालत आहे, रेसिपी / सेटपॉइंट बदलला आहे, किंवा HMI वर "download" किंवा "program changed" दिसत आहे.', 'मशीन विचित्र चालत असेल तर ती सुरक्षितपणे थांबवा. स्वतः काहीही परत बदलू नका. काय बदलले ते लिहून ठेवा.', `आत्ताच मेंटेनन्स इंजिनिअरला फोन करा: ${ENGINEER}`],
      ta: ['இயந்திர நிரல் அல்லது அமைப்பு மாற்றப்பட்டது', 'இயந்திரம் வேறு மாதிரி இயங்குகிறது, ரெசிபி / செட்பாயிண்ட் மாறியுள்ளது, அல்லது HMI-ல் "download" அல்லது "program changed" தெரிகிறது.', 'இயந்திரம் விசித்திரமாக இயங்கினால் பாதுகாப்பாக நிறுத்தவும். நீங்களே எதையும் மாற்றாதீர்கள். என்ன மாறியது என்று குறித்துக்கொள்ளுங்கள்.', `உடனே பராமரிப்பு பொறியாளரை அழைக்கவும்: ${ENGINEER}`],
    },
  },
  {
    // Fallback for event types the gateway sends before an engineer has written a template.
    eventTypeKey: 'UNKNOWN_EVENT',
    defaultSeverity: 'AMBER',
    iconName: 'alert',
    ownerFollowUp: 'Ask the engineer to review this event and create a template for it.',
    loc: {
      en: ['Unusual security event', 'The gateway noticed something unusual on this machine.', 'Keep working safely. Do not change any settings.', `Inform Maintenance Engineer: ${ENGINEER}`],
      hi: ['असामान्य सुरक्षा घटना', 'गेटवे ने इस मशीन पर कुछ असामान्य देखा है।', 'सुरक्षित रूप से काम करते रहें। कोई सेटिंग न बदलें।', `मेंटेनेंस इंजीनियर को बताएँ: ${ENGINEER}`],
      mr: ['असामान्य सुरक्षा घटना', 'गेटवेला या मशीनवर काहीतरी असामान्य दिसले आहे.', 'सुरक्षितपणे काम चालू ठेवा. कोणतीही सेटिंग बदलू नका.', `मेंटेनन्स इंजिनिअरला कळवा: ${ENGINEER}`],
      ta: ['அசாதாரண பாதுகாப்பு நிகழ்வு', 'கேட்வே இந்த இயந்திரத்தில் ஏதோ அசாதாரணத்தைக் கவனித்தது.', 'பாதுகாப்பாக வேலையைத் தொடருங்கள். எந்த அமைப்பையும் மாற்றாதீர்கள்.', `பராமரிப்பு பொறியாளருக்குத் தெரிவிக்கவும்: ${ENGINEER}`],
    },
  },
];
