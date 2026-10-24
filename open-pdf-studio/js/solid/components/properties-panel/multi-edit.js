// Tekstvelden in het eigenschappenpaneel bij één of meer markeringen.
//
// Eén markering: elke toets meteen doorgeven (de undo-manager voegt snelle
// wijzigingen samen tot één stap). Een meervoudige selectie: pas bij het
// verlaten of Enter (change), zodat de wijziging voor alle markeringen één
// undo-stap is en niet één per toets. Verschillen de waarden, dan is het veld
// leeg met "Gemengd" als placeholder (propertiesStore: <key>Mixed).

import { annotProps, updateAnnotProp } from '../../stores/propertiesStore.js';

const isMulti = () => annotProps.multiCount > 0;

/** onInput/onChange voor een tekstveld dat `key` bewerkt. */
export function textFieldHandlers(key) {
  return {
    onInput: (e) => { if (!isMulti()) updateAnnotProp(key, e.currentTarget.value); },
    onChange: (e) => { if (isMulti()) updateAnnotProp(key, e.currentTarget.value); },
  };
}

/** De placeholder: "Gemengd" bij verschillende waarden, anders de gewone. */
export function mixedPlaceholder(key, mixedText, normal) {
  return isMulti() && annotProps[`${key}Mixed`] ? mixedText : normal;
}
