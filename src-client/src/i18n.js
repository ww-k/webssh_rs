import i18n from "i18next";
import Backend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import translation from "public/locales/zh/translation.json";

i18n
    // load translation using http -> see /public/locales
    // learn more: https://github.com/i18next/i18next-http-backend
    .use(Backend)
    // detect user language
    // learn more: https://github.com/i18next/i18next-browser-languageDetector
    .use(LanguageDetector)
    // pass the i18n instance to react-i18next.
    .use(initReactI18next)
    // init i18next
    // for all options read: https://www.i18next.com/overview/configuration-options
    .init({
        fallbackLng: "zh",
        debug: true,
        // 预加载默认语言
        preload: ["zh"],
        // 不重新加载已加载的语言
        partialBundledLanguages: true,
        // 将默认语言资源直接包含在配置中
        resources: {
            zh: {
                translation,
            },
        },
    });

export default i18n;
