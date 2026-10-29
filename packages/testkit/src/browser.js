// Finding a browser to test with: `CHROME_PATH` / `FIREFOX_PATH` first, then where each is usually installed.
import { existsSync } from 'node:fs';

const paths = () => ({
  chrome: [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ],
  firefox: [
    process.env.FIREFOX_PATH,
    'C:/Program Files/Mozilla Firefox/firefox.exe',
    'C:/Program Files (x86)/Mozilla Firefox/firefox.exe',
    '/usr/bin/firefox', '/Applications/Firefox.app/Contents/MacOS/firefox',
  ],
});

/** The path of an installed browser (`CHROME_PATH` / `FIREFOX_PATH` first, then the usual places), or undefined. @param {'chrome' | 'firefox'} [browser] @returns {string | undefined} */
export const findBrowser = (browser = 'chrome') => paths()[browser].filter(Boolean).find((p) => existsSync(p));
/** The path of an installed Chrome (or Edge), or undefined. @returns {string | undefined} */
export const findChrome = () => findBrowser('chrome');
