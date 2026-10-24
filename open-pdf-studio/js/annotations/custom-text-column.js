// One document-scoped text column. PDF input is untrusted, so only bounded,
// single-line strings are admitted to the model and to exports.
export const CUSTOM_TEXT_NAME_MAX = 48;
export const CUSTOM_TEXT_VALUE_MAX = 256;

const RESERVED = new Set(['page', 'type', 'comment', 'status', 'author', 'subject',
  'text', 'replies', 'created', 'modified', 'layer']);
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/u;

export function customTextColumnName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  return name && name.length <= CUSTOM_TEXT_NAME_MAX && !CONTROLS.test(name)
    && !RESERVED.has(name.toLocaleLowerCase()) ? name : '';
}

export function customTextValue(value) {
  if (typeof value !== 'string' || value.length > CUSTOM_TEXT_VALUE_MAX || CONTROLS.test(value)) return '';
  return value;
}
