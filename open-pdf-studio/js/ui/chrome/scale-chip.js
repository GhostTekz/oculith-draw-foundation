// The page scale chip in the status bar and the navigation bar: its text,
// its colour and its tooltip, from pageScaleStatus (scale-entry.js).
//
//   ok       a confirmed scale (green)
//   detected a scale read from the sheet, not applied yet (amber): click to review
//   unset    no scale (red): click to set or calibrate
//
// Pure, so node tests every state.

/**
 * @param {object|null} status  pageScaleStatus(...)
 * @param {(key:string, opts?:object)=>string} t  statusbar translations
 * @param {string} [setLabel]  the display label of a set scale (scaleLabel)
 * @returns {{text:string, tone:'ok'|'detected'|'unset', title:string, review:boolean}|null}
 */
export function scaleChip(status, t, setLabel = '') {
  if (!status) return null;
  const regions = status.regions ? ` ${t('scaleRegions')}` : '';
  if (status.kind === 'set') {
    const label = setLabel || status.ratio;
    const auto = status.method === 'auto-detect';
    const pending = Number(status.pendingViews) || 0;
    let text = auto ? t('navbar.scaleAuto', { scale: label }) : label;
    if (pending) text += ` ${t('scalePendingViews', { count: pending })}`;
    const title = status.source
      ? t('scaleSetSourceTitle', { ratio: status.ratio, source: status.source })
      : t('scaleTitle');
    return { text: text + regions, tone: auto || pending ? 'detected' : 'ok',
      title: pending ? `${title}\n${t('scalePendingTitle', { count: pending })}` : title, review: pending > 0 };
  }
  if (status.kind === 'detected') {
    const text = status.ratio
      ? t('scaleDetected', { ratio: status.ratio })
      : t('scaleDetectedViews', { count: status.views || 0 });
    const source = status.sourceText
      ? t('scaleDetectedTitle', { source: status.sourceText,
        confidence: status.confidence != null ? Math.round(status.confidence * 100) : '?' })
      : t('scaleDetectedPlainTitle');
    return { text: text + regions, tone: 'detected', title: source, review: status.sourceText != null && status.source != null };
  }
  return { text: t('scaleNotSet') + regions, tone: 'unset', title: t('scaleNotSetTitle'), review: false };
}

/** The chip was clicked: review the proposals of the page, else Set Scale. */
export async function openScaleChip(chip, pageNum) {
  if (chip?.review) {
    const { openDialog } = await import('../../solid/stores/dialogStore.js');
    openDialog('scaleReview', { pageNum });
    return;
  }
  const { showSetScaleDialog } = await import('../../annotations/measurement.js');
  showSetScaleDialog(pageNum);
}
