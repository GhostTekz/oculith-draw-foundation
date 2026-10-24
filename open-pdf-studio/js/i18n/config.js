import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { edition } from '../editions/active.js';

// Locale bundles are loaded on demand, one language at a time, instead of
// statically importing all 37 languages (296 JSON files) into the entry
// chunk. Only English (the fallback) and the active language are fetched at
// startup; switching language fetches that language's 8 namespace files on
// first use. This keeps the main bundle small and startup parse/init fast.
const localeModules = import.meta.glob('./locales/*/*.json');

const ns = ['common', 'ribbon', 'preferences', 'dialogs', 'appMenu', 'properties', 'context', 'statusbar'];
// The product name comes from the edition (Foundation, or an installed plug-in's).
const communityBuild = edition.id === 'foundation';
const productName = edition.productName;

// Keep translated sentences while replacing the product name in Community.
// Attribution and desktop identifiers are separate and must remain intact.
function communityProductText(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => communityProductText(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, communityProductText(item, childKey)]));
  }
  return typeof value === 'string' && !['copyright', 'license'].includes(key)
    ? value.replaceAll('Oculith Draw', productName)
    : value;
}

export const LANGUAGES = [
  { code: 'auto', name: 'Auto-detect', englishName: 'Auto-detect' },
  { code: 'ar', name: 'العربية', englishName: 'Arabic', dir: 'rtl' },
  { code: 'bn', name: 'বাংলা', englishName: 'Bengali' },
  { code: 'bg', name: 'Български', englishName: 'Bulgarian' },
  { code: 'ca', name: 'Català', englishName: 'Catalan' },
  { code: 'zh', name: '中文', englishName: 'Chinese' },
  { code: 'hr', name: 'Hrvatski', englishName: 'Croatian' },
  { code: 'cs', name: 'Čeština', englishName: 'Czech' },
  { code: 'da', name: 'Dansk', englishName: 'Danish' },
  { code: 'nl', name: 'Nederlands', englishName: 'Dutch' },
  { code: 'en', name: 'English', englishName: 'English' },
  { code: 'fa', name: 'فارسی', englishName: 'Farsi', dir: 'rtl' },
  { code: 'fi', name: 'Suomi', englishName: 'Finnish' },
  { code: 'fr', name: 'Français', englishName: 'French' },
  { code: 'de', name: 'Deutsch', englishName: 'German' },
  { code: 'el', name: 'Ελληνικά', englishName: 'Greek' },
  { code: 'he', name: 'עברית', englishName: 'Hebrew', dir: 'rtl' },
  { code: 'hi', name: 'हिन्दी', englishName: 'Hindi' },
  { code: 'hu', name: 'Magyar', englishName: 'Hungarian' },
  { code: 'id', name: 'Bahasa Indonesia', englishName: 'Indonesian' },
  { code: 'it', name: 'Italiano', englishName: 'Italian' },
  { code: 'ja', name: '日本語', englishName: 'Japanese' },
  { code: 'ko', name: '한국어', englishName: 'Korean' },
  { code: 'ms', name: 'Bahasa Melayu', englishName: 'Malay' },
  { code: 'nb', name: 'Norsk', englishName: 'Norwegian' },
  { code: 'pl', name: 'Polski', englishName: 'Polish' },
  { code: 'pt', name: 'Português', englishName: 'Portuguese' },
  { code: 'ro', name: 'Română', englishName: 'Romanian' },
  { code: 'ru', name: 'Русский', englishName: 'Russian' },
  { code: 'sr', name: 'Српски', englishName: 'Serbian' },
  { code: 'sk', name: 'Slovenčina', englishName: 'Slovak' },
  { code: 'es', name: 'Español', englishName: 'Spanish' },
  { code: 'sw', name: 'Kiswahili', englishName: 'Swahili' },
  { code: 'sv', name: 'Svenska', englishName: 'Swedish' },
  { code: 'ta', name: 'தமிழ்', englishName: 'Tamil' },
  { code: 'th', name: 'ไทย', englishName: 'Thai' },
  { code: 'tr', name: 'Türkçe', englishName: 'Turkish' },
  { code: 'uk', name: 'Українська', englishName: 'Ukrainian' },
  { code: 'ur', name: 'اردو', englishName: 'Urdu', dir: 'rtl' },
  { code: 'vi', name: 'Tiếng Việt', englishName: 'Vietnamese' },
];

export const RTL_LANGUAGES = ['ar', 'fa', 'he', 'ur'];

export function isRTL(lang) {
  return RTL_LANGUAGES.includes(lang);
}

function isKnownLanguage(lng) {
  return LANGUAGES.some((l) => l.code === lng);
}

// Fetch all 8 namespace bundles for one language. Missing files are skipped
// (same effect as the language simply not providing that namespace).
async function fetchLocale(lng) {
  const bundles = {};
  await Promise.all(ns.map(async (n) => {
    const importer = localeModules[`./locales/${lng}/${n}.json`];
    if (!importer) return;
    const mod = await importer();
    const data = mod.default || mod;
    bundles[n] = communityBuild ? communityProductText(data) : data;
  }));
  // Product names and legal attribution must not revert to the upstream
  // application's text when the user switches language. Translations for the
  // rest of the interface stay in their original locale bundles.
  if (bundles.common) {
    bundles.common = {
      ...bundles.common,
      appName: productName,
      menu: { ...bundles.common.menu, oculith: productName },
    };
  }
  if (bundles.appMenu?.aboutPanel) {
    bundles.appMenu = {
      ...bundles.appMenu,
      aboutPanel: {
        ...bundles.appMenu.aboutPanel,
        appName: productName,
        tagline: 'Construction drawing review and markup.',
        description: `Open, annotate, and review PDF drawings locally. ${productName} builds on Open PDF Studio by OpenAEC Foundation.`,
        companyName: productName,
        companyDescription: 'Based on Open PDF Studio by OpenAEC Foundation.',
        copyright: 'Open PDF Studio © 2026 OpenAEC Foundation; OcuDraw modifications © 2026 GhostTekz',
        license: communityBuild
          ? 'Oculith Draw Foundation is LGPL-3.0-or-later. Request matching source from the distributor of this build.'
          : edition.about?.license || 'The PDF editor core is LGPL-3.0-or-later. Edition plug-ins and engines are separately licensed.',
      },
    };
  }
  return bundles;
}

const loadedLanguages = new Set();

// Load a language into i18next on demand. Idempotent; unknown codes no-op.
export async function loadLocale(lng) {
  const base = (lng || '').split('-')[0];
  if (!base || loadedLanguages.has(base) || !isKnownLanguage(base)) return;
  const bundles = await fetchLocale(base);
  Object.entries(bundles).forEach(([n, data]) => {
    i18next.addResourceBundle(base, n, data, true, true);
  });
  loadedLanguages.add(base);
}

// Mirror the LanguageDetector order (localStorage, then navigator) so the
// language it will pick is already loaded before init.
function detectInitialLanguage() {
  try {
    const stored = localStorage.getItem('i18nextLng');
    if (stored) return stored.split('-')[0];
  } catch (_) { /* storage unavailable */ }
  return (navigator.language || 'en').split('-')[0];
}

const initialResources = { en: await fetchLocale('en') };
loadedLanguages.add('en');

const initialLng = detectInitialLanguage();
if (initialLng !== 'en' && isKnownLanguage(initialLng)) {
  initialResources[initialLng] = await fetchLocale(initialLng);
  loadedLanguages.add(initialLng);
}

i18next
  .use(LanguageDetector)
  .init({
    resources: initialResources,
    ns,
    defaultNS: 'common',
    fallbackLng: 'en',
    showSupportNotice: false,
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: []
    }
  });

export default i18next;
