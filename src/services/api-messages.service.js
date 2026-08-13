const messages = {
  hi: {
    NOT_FOUND: "माँगा गया रिकॉर्ड नहीं मिला।",
    VALIDATION_ERROR: "एक या अधिक फ़ील्ड सही नहीं हैं।",
    AUTH_REQUIRED: "जारी रखने के लिए साइन इन करें।",
    TOKEN_INVALID: "आपका सत्र समाप्त हो गया है। कृपया फिर से साइन इन करें।",
    SESSION_INVALID: "आपका सत्र समाप्त हो गया है। कृपया फिर से साइन इन करें।",
    FORBIDDEN: "आपको यह कार्य करने की अनुमति नहीं है।",
    INTERNAL_ERROR: "एक अनपेक्षित त्रुटि हुई। कृपया फिर से कोशिश करें।",
  },
  gu: {
    NOT_FOUND: "માગેલ રેકોર્ડ મળ્યો નથી.",
    VALIDATION_ERROR: "એક અથવા વધુ વિગતો યોગ્ય નથી.",
    AUTH_REQUIRED: "આગળ વધવા માટે સાઇન ઇન કરો.",
    TOKEN_INVALID: "તમારું સત્ર સમાપ્ત થયું છે. કૃપા કરીને ફરી સાઇન ઇન કરો.",
    SESSION_INVALID: "તમારું સત્ર સમાપ્ત થયું છે. કૃપા કરીને ફરી સાઇન ઇન કરો.",
    FORBIDDEN: "તમને આ કાર્ય કરવાની પરવાનગી નથી.",
    INTERNAL_ERROR: "અણધારી ભૂલ થઈ. કૃપા કરીને ફરી પ્રયાસ કરો.",
  },
  mr: {
    NOT_FOUND: "मागितलेली नोंद सापडली नाही.",
    VALIDATION_ERROR: "एक किंवा अधिक माहिती योग्य नाही.",
    AUTH_REQUIRED: "पुढे जाण्यासाठी साइन इन करा.",
    TOKEN_INVALID: "तुमचे सत्र संपले आहे. कृपया पुन्हा साइन इन करा.",
    SESSION_INVALID: "तुमचे सत्र संपले आहे. कृपया पुन्हा साइन इन करा.",
    FORBIDDEN: "तुम्हाला ही कृती करण्याची परवानगी नाही.",
    INTERNAL_ERROR: "अनपेक्षित त्रुटी आली. कृपया पुन्हा प्रयत्न करा.",
  },
};

function apiMessage(locale, code, english) {
  return messages[locale]?.[code] || english;
}

module.exports = { apiMessage };
