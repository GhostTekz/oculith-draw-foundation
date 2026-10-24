import { createSignal } from 'solid-js';
import { createSheetRegister, parseSheetRegister } from '../../sets/sheet-register.js';

const STORAGE_KEY = 'oculithDraw.sheetRegister.v1';

function load() {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    return saved ? parseSheetRegister(saved) : createSheetRegister();
  } catch (error) {
    console.warn('Could not restore drawing set:', error);
    return createSheetRegister();
  }
}

const [sheetRegister, setSheetRegister] = createSignal(load());

export function saveSheetRegister(register) {
  const checked = parseSheetRegister(register);
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(checked));
  setSheetRegister(checked);
}

export { sheetRegister };
