// Fields a markup can have edited in place in the Markups List: the comment
// and the document's custom Text, Choice and Number columns. Values are
// checked against the same rules as the Columns menu, so a value the list
// accepts always survives a save. Other modules can add their own
// follow-up to an edit (keeping data of their own in step with the field)
// through `onMarkupFieldEdit`; that runs inside the same undoable change.
// No app imports here.
import { customTextValue } from './custom-text-column.js';
import { choiceValue } from './custom-choice-column.js';
import { numberValue } from './custom-number-column.js';

export const COMMENT_MAX = 4000;

/** Which annotation property each editable list column writes. */
export const FIELD_OF_COLUMN = Object.freeze({
  comment: 'text',
  customText: 'markupTextValue',
  customText2: 'markupTextValue2',
  customChoice: 'markupChoiceValue',
  customChoice2: 'markupChoiceValue2',
  customNumber: 'markupNumberValue',
  customNumber2: 'markupNumberValue2',
});

/** Whether the document has the column a field belongs to. */
export function fieldColumnDefined(doc, field) {
  switch (field) {
    case 'text': return true;
    case 'markupTextValue': return !!doc?.markupTextColumnName;
    case 'markupTextValue2': return !!doc?.markupTextColumn2Name;
    case 'markupChoiceValue': return !!doc?.markupChoiceColumn?.options?.length;
    case 'markupChoiceValue2': return !!doc?.markupChoiceColumn2?.options?.length;
    case 'markupNumberValue': return !!doc?.markupNumberColumn;
    case 'markupNumberValue2': return !!doc?.markupNumberColumn2;
    default: return false;
  }
}

/**
 * The value to store for a field, or `undefined` when the input is not
 * allowed. An empty input clears the field (`''`, or `null` for numbers).
 */
export function fieldValue(doc, field, raw) {
  const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  switch (field) {
    case 'text':
      return text.length <= COMMENT_MAX && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) ? text : undefined;
    case 'markupTextValue':
    case 'markupTextValue2':
      return text === '' || customTextValue(text) === text ? text : undefined;
    case 'markupChoiceValue':
    case 'markupChoiceValue2': {
      if (text === '') return '';
      const options = (field === 'markupChoiceValue' ? doc?.markupChoiceColumn : doc?.markupChoiceColumn2)?.options;
      return choiceValue(text, options) || undefined;
    }
    case 'markupNumberValue':
    case 'markupNumberValue2': {
      if (text.trim() === '') return null;
      const n = numberValue(text.trim());
      return n === null ? undefined : n;
    }
    default: return undefined;
  }
}

const hooks = new Set();

/**
 * Run `fn(annotation, field, value, doc)` after a list edit, inside the same
 * undoable change. `field` is an annotation property name or 'status'.
 * Returns a function that removes the hook.
 */
export function onMarkupFieldEdit(fn) {
  hooks.add(fn);
  return () => hooks.delete(fn);
}

export function runMarkupFieldHooks(annotation, field, value, doc) {
  for (const fn of hooks) {
    try { fn(annotation, field, value, doc); }
    catch (error) { console.warn('[markup-fields] edit hook failed:', error); }
  }
}
