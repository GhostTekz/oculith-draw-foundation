import { For, Show, createMemo, createSignal } from 'solid-js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import { state, getActiveDocument } from '../../../../core/state.js';
import { getScaleForPoint } from '../../../../annotations/scale-bar.js';
import { paginaOfDocumentSchaal } from '../../../../annotations/schaal-op-punt.js';
import { redrawAnnotations, redrawContinuous } from '../../../../annotations/rendering.js';
import { showProperties } from '../../../../ui/panels/properties-panel.js';
import { goToPage } from '../../../../pdf/renderer.js';
import { recordDelete } from '../../../../core/undo-manager.js';
import { setTool } from '../../../../tools/manager.js';
import { openDialog } from '../../../stores/dialogStore.js';
import { pixelsPerUnitFor } from '../../../../annotations/scale-region.js';
import { viewportsOpPagina, alleViewports, hernoemViewport, verwijderViewports, wisViewports } from '../../../../annotations/named-viewports.js';
import { useTranslation } from '../../../../i18n/useTranslation.js';
import { sumMeasurements } from '../../../../quantities/measurement-summary.js';
import { measureKindType, summaryValue, MEASURE_KIND_NAMES } from '../../../../annotations/measure-extras.js';
import { formatMeasurement } from '../../../../annotations/measurement.js';
import { measurementLegend, legendTotalText, legendTable } from '../../../../quantities/measurement-legend.js';
import { racewaySchedule, racewayLengthText, racewayBendText, racewayScheduleTable } from '../../../../quantities/raceway-schedule.js';
import { fittingsText } from '../../../../annotations/raceway.js';
import { createAnnotation } from '../../../../annotations/factory.js';
import { recordAdd } from '../../../../core/undo-manager.js';

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

const measureTypes = new Set(['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle']);

const typeLabels = {
  measureDistance: 'Distance',
  measureArea: 'Area',
  measurePerimeter: 'Perimeter',
  measureAngle: 'Angle',
  count: 'Count',
  ...MEASURE_KIND_NAMES,
};

const typeIcons = {
  measureDistance: '\u2194',
  measureArea: '\u25A1',
  measurePerimeter: '\u25B3',
  measureAngle: '\u2220',
  measurePolylength: '\u2933',
  measureArc: '\u25E0',
  measureVolume: '\u25A3',
  measureRadius: 'R',
};

export default function MeasurementsPanel() {
  const { t } = useTranslation('properties');

  // ── Current scale ──
  const currentScale = createMemo(() => {
    const doc = getActiveDocument();
    const ms = paginaOfDocumentSchaal(doc, doc?.currentPage || 1);
    if (ms && ms.pixelsPerUnit > 0) {
      if (ms.scaleRatio) return ms.scaleRatio;
      return `1px = ${(1 / ms.pixelsPerUnit).toFixed(4)} ${ms.unit}`;
    }
    return null;
  });

  // ── Viewports ──
  // Named viewports (scaleRegion) of the current page, then the older
  // viewport annotations (MCP) of that page.
  const currentPage = () => getActiveDocument()?.currentPage || 1;
  const namedViewports = createMemo(() => viewportsOpPagina(getActiveDocument(), currentPage()));
  const viewports = createMemo(() => {
    const doc = getActiveDocument();
    if (!doc) return [];
    return (doc.annotations || []).filter(a => a.type === 'viewport' && a.page === currentPage());
  });
  const [renamingId, setRenamingId] = createSignal(null);
  // Inline "Clear All" confirmation: null, or the scope being confirmed.
  const [clearScope, setClearScope] = createSignal(null);
  const clearCount = () => {
    const doc = getActiveDocument();
    if (clearScope() === 'document') return alleViewports(doc).length;
    return viewportsOpPagina(doc, currentPage()).length;
  };

  function viewportScaleText(vp) {
    return pixelsPerUnitFor(vp.scaleString, vp.units)
      ? `${vp.scaleString} [${vp.units}]`
      : (t('viewports.noScale') || 'Scale not set');
  }

  function addViewport() {
    setClearScope(null);
    setTool('scaleRegion');
  }

  function editViewportScale(vp) {
    openDialog('scale-region', { annotationId: vp.id, pageNum: vp.page, isNew: false });
  }

  function commitRename(vp, value) {
    if (renamingId() !== vp.id) return;
    setRenamingId(null);
    if (hernoemViewport(vp.id, value).ok) redraw();
  }

  function deleteNamedViewport(vp) {
    if (verwijderViewports([vp.id])) redraw();
  }

  function confirmClear() {
    const scope = clearScope();
    setClearScope(null);
    if (scope && wisViewports(scope, currentPage())) redraw();
  }

  // ── Measurements ──
  const measurements = createMemo(() => {
    const doc = getActiveDocument();
    if (!doc) return [];
    return (doc.annotations || []).filter(a => measureTypes.has(a.type));
  });

  // ── Grouped by type ──
  const groupedMeasurements = createMemo(() => {
    const groups = {};
    for (const m of measurements()) {
      // Polylength, Volume, Arc and Radius group apart from their base type.
      const type = measureKindType(m);
      if (!groups[type]) groups[type] = [];
      groups[type].push(m);
    }
    return groups;
  });

  // ── Totals per type ──
  const totals = createMemo(() => {
    const result = {};
    for (const [type, items] of Object.entries(groupedMeasurements())) {
      if (type === 'measureAngle') {
        result[type] = items.length + ' angles';
      } else {
        // A Volume adds its volume (unit³), never its area.
        const total = sumMeasurements(items.map(summaryValue));
        // Same formatting as the labels: feet-inches for imperial lengths,
        // "Scale not set" for page points.
        result[type] = total
          ? formatMeasurement({ value: total.value, unit: total.unit, calibrated: !/^pt[²³]?$/u.test(total.unit) })
          : items.some(m => Number.isFinite(m.measureValue))
            ? t('measurements.mixedUnits', { defaultValue: 'Mixed or unknown units' })
            : t('measurements.noValues', { defaultValue: 'No measured values' });
      }
    }
    return result;
  });

  // ── Legend (the external editor: Measurement legend) ──
  // Per Subject and type: colour, count, total; this page or the document.
  const [legendScope, setLegendScope] = createSignal('page');
  const typeName = (type) => t(`types.${type}`, { defaultValue: typeLabels[type] || type });
  const legendLabels = () => ({
    mixed: t('measurements.mixedUnits', { defaultValue: 'Mixed or unknown units' }),
    none: t('measurements.noValues', { defaultValue: 'No measured values' }),
  });
  const legendRows = createMemo(() => {
    const doc = getActiveDocument();
    if (!doc) return [];
    // Read the list so the memo follows added and removed measurements.
    measurements();
    return measurementLegend(doc.annotations, { page: legendScope() === 'page' ? currentPage() : null });
  });

  // Place the legend on the current page as a table (scheduleTable), at the
  // top left; it can be moved like any markup. One undo step.
  function placeLegend() {
    const doc = getActiveDocument();
    const rows = legendRows();
    if (!doc || !rows.length) return;
    const table = legendTable(rows, {
      title: t('measurements.legend', { defaultValue: 'Legend' }),
      color: t('measurements.legendColor', { defaultValue: 'Color' }),
      subject: t('measurements.legendSubject', { defaultValue: 'Subject' }),
      count: t('measurements.legendCount', { defaultValue: 'Count' }),
      total: t('measurements.legendTotal', { defaultValue: 'Total' }),
      typeName, ...legendLabels(),
    }, formatMeasurement);
    const ann = createAnnotation({
      type: 'scheduleTable', page: currentPage(), x: 36, y: 36,
      width: table.width, height: table.height, title: table.title,
      columns: table.columns, rows: table.rows,
      subject: t('measurements.legend', { defaultValue: 'Legend' }),
      color: '#000000', lineWidth: 0.5, opacity: 1,
    });
    doc.annotations.push(ann);
    recordAdd(ann);
    redraw();
  }

  // ── Raceway schedule (the external editor: Legend / Markups Summary for raceways) ──
  // Per run tag and size: runs, developed length, fittings, worst bends.
  const [racewayScope, setRacewayScope] = createSignal('page');
  const hasRaceways = createMemo(() => racewaySchedule(measurements()).length > 0);
  const racewayRows = createMemo(() => {
    measurements();
    const doc = getActiveDocument();
    if (!doc) return [];
    return racewaySchedule(doc.annotations, { page: racewayScope() === 'page' ? currentPage() : null });
  });
  const rt = (key, def, opts = {}) => t(`racewaySchedule.${key}`, { defaultValue: def, ...opts });

  // Place the schedule on the current page as a table, like the legend.
  // Its columns narrow to fit the page width (36 pt margins).
  async function placeRacewaySchedule() {
    const doc = getActiveDocument();
    const rows = racewayRows();
    if (!doc || !rows.length) return;
    const pageNum = currentPage();
    let maxWidth = 0;
    try {
      const pdfPage = await doc.pdfDoc?.getPage?.(pageNum);
      // Annotation space is the page's viewport at scale 1, as the loader uses.
      const vp = pdfPage?.getViewport?.({ scale: 1 });
      if (vp?.width > 0) maxWidth = vp.width - 72;
    } catch { /* no page size: natural width */ }
    if (getActiveDocument() !== doc) return;
    const fittingNames = { pull: rt('pull', 'Pull box'), up: rt('up', '90° up'), down: rt('down', '90° down'),
      tee: rt('tee', 'Tee'), cross: rt('cross', 'Cross'), reducer: rt('reducer', 'Reducer'),
      custom: rt('custom', 'Custom') };
    const table = racewayScheduleTable(rows, {
      title: rt('title', 'Raceway schedule'),
      tag: rt('tag', 'Tag'), size: rt('size', 'Raceway'), runs: rt('runs', 'Runs'),
      length: rt('length', 'Length'), bends: rt('bends', 'Max bends'),
      fitting: (k) => fittingNames[k] ?? `${k}°`,
      ...legendLabels(),
    }, formatMeasurement, { maxWidth });
    const ann = createAnnotation({
      type: 'scheduleTable', page: pageNum, x: 36, y: 36,
      width: table.width, height: table.height, title: table.title,
      columns: table.columns, rows: table.rows,
      subject: rt('title', 'Raceway schedule'),
      color: '#000000', lineWidth: 0.5, opacity: 1,
    });
    doc.annotations.push(ann);
    recordAdd(ann);
    redraw();
  }

  // ── Click to navigate ──
  function navigateTo(ann) {
    const doc = getActiveDocument();
    if (!doc) return;

    // Go to the page
    if (doc.currentPage !== ann.page) {
      goToPage(ann.page);
    }

    // Select the annotation
    doc.selectedAnnotations = [ann];
    doc.selectedAnnotation = ann;
    showProperties(ann);
    redraw();
  }

  function deleteViewport(ann, control) {
    const doc = getActiveDocument();
    if (!doc) return;
    const idx = doc.annotations.indexOf(ann);
    if (idx !== -1) {
      const row = control?.closest('.measurements-item');
      const focusTarget = row?.nextElementSibling?.querySelector('.measurements-item-select')
        || row?.previousElementSibling?.querySelector('.measurements-item-select')
        || document.querySelector('#panel-measurements .measurements-group .measurements-item-select');
      recordDelete(ann, idx);
      doc.annotations.splice(idx, 1);
      if (doc.selectedAnnotation === ann) doc.selectedAnnotation = null;
      doc.selectedAnnotations = (doc.selectedAnnotations || []).filter(item => item !== ann);
      redraw();
      queueMicrotask(() => { if (focusTarget?.isConnected) focusTarget.focus(); });
    }
  }

  return (
    <div class={`left-panel-content${activeTab() === 'measurements' ? ' active' : ''}`} id="panel-measurements">
      <div class="left-panel-header">
        <span>{t('leftPanel.measurements') || 'Measurements'}</span>
      </div>

      {/* ── Scale Section ── */}
      <div class="measurements-section">
        <div class="measurements-section-header">
          <span>{t('measurements.scale') || 'Scale'}</span>
        </div>
        <div class="measurements-scale-display">
          <Show when={currentScale()} fallback={
            <span class="measurements-empty">{t('measurements.noScale') || 'No scale set'}</span>
          }>
            <span class="measurements-scale-value">{currentScale()}</span>
          </Show>
        </div>
      </div>

      {/* ── Viewports Section ── */}
      <div class="measurements-section" id="measurements-viewports">
        <div class="measurements-section-header">
          <span>{t('measurements.viewports') || 'Viewports'}</span>
          <span class="measurements-count">{namedViewports().length + viewports().length}</span>
        </div>
        <div class="measurements-viewport-actions">
          <button type="button" class="measurements-viewport-btn" id="measurements-add-viewport"
            title={t('viewports.addTitle') || 'Drag a rectangle with its own scale (Shift: square)'}
            disabled={!getActiveDocument()} onClick={addViewport}>
            {t('viewports.add') || 'Add Viewport'}
          </button>
          <button type="button" class="measurements-viewport-btn" id="measurements-clear-viewports"
            disabled={alleViewports(getActiveDocument()).length === 0}
            onClick={() => setClearScope(clearScope() ? null : (namedViewports().length ? 'page' : 'document'))}>
            {t('viewports.clearAll') || 'Clear All'}
          </button>
        </div>
        <Show when={clearScope()}>
          <div class="measurements-viewport-confirm" role="group" aria-label={t('viewports.clearAll') || 'Clear All'}>
            <label>
              <input type="radio" name="vp-clear-scope" checked={clearScope() === 'page'}
                onChange={() => setClearScope('page')} />
              {t('viewports.clearPage') || 'This page'}
            </label>
            <label>
              <input type="radio" name="vp-clear-scope" checked={clearScope() === 'document'}
                onChange={() => setClearScope('document')} />
              {t('viewports.clearDocument') || 'Whole document'}
            </label>
            <div class="measurements-viewport-confirm-buttons">
              <button type="button" class="measurements-viewport-btn" disabled={clearCount() === 0}
                onClick={confirmClear}>
                {t('viewports.confirmClear', { count: clearCount() }) || `Delete ${clearCount()}`}
              </button>
              <button type="button" class="measurements-viewport-btn" onClick={() => setClearScope(null)}>
                {t('viewports.cancel') || 'Cancel'}
              </button>
            </div>
          </div>
        </Show>
        <Show when={namedViewports().length === 0 && viewports().length === 0}>
          <div class="measurements-empty">{t('viewports.none') || 'No viewports on this page'}</div>
        </Show>
        <For each={namedViewports()}>
          {(vp) => (
            <div class="measurements-item measurements-named-viewport" data-viewport-id={vp.id}>
              <Show when={renamingId() === vp.id} fallback={
                <button type="button" class="measurements-item-select measurements-viewport-select"
                  title={t('viewports.changeScale') || 'Change scale'}
                  onClick={() => editViewportScale(vp)}>
                  <span class="measurements-item-icon measurements-viewport-icon">&#9634;</span>
                  <span class="measurements-item-info">
                    <span class="measurements-item-name">{vp.label || (t('viewports.unnamed') || '(unnamed)')}</span>
                    <span class="measurements-item-detail">{viewportScaleText(vp)}</span>
                  </span>
                </button>
              }>
                <input type="text" class="ribbon-input measurements-viewport-rename"
                  value={vp.label || ''}
                  aria-label={t('viewports.rename') || 'Rename'}
                  ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(vp, e.currentTarget.value);
                    else if (e.key === 'Escape') setRenamingId(null);
                  }}
                  onBlur={(e) => commitRename(vp, e.currentTarget.value)} />
              </Show>
              <button type="button" class="measurements-item-delete measurements-viewport-rename-btn"
                title={t('viewports.rename') || 'Rename'}
                aria-label={`${t('viewports.rename') || 'Rename'} ${vp.label || ''}`}
                onClick={() => setRenamingId(vp.id)}>
                &#9998;
              </button>
              <button type="button" class="measurements-item-delete"
                title={t('viewports.delete') || 'Delete'}
                aria-label={`${t('viewports.delete') || 'Delete'} ${vp.label || ''}`}
                onClick={() => deleteNamedViewport(vp)}>
                &times;
              </button>
            </div>
          )}
        </For>
        <For each={viewports()}>
          {(vp) => (
            <div class="measurements-item" classList={{ selected: getActiveDocument()?.selectedAnnotation?.id === vp.id }}>
              <button type="button" class="measurements-item-select measurements-viewport-select"
                aria-pressed={getActiveDocument()?.selectedAnnotation?.id === vp.id}
                onClick={() => navigateTo(vp)}>
                <span class="measurements-item-icon measurements-viewport-icon">&#9634;</span>
                <span class="measurements-item-info">
                  <span class="measurements-item-name">{vp.name || vp.scaleRatio || 'Viewport'}</span>
                  <span class="measurements-item-detail">
                    {vp.scaleRatio || `1px = ${(1/vp.pixelsPerUnit).toFixed(4)} ${vp.unit}`}
                    {' \u2022 Page ' + vp.page}
                  </span>
                </span>
              </button>
              <button type="button" class="measurements-item-delete"
                aria-label={`Delete viewport ${vp.name || vp.scaleRatio || 'Viewport'}`}
                onClick={(event) => deleteViewport(vp, event.currentTarget)}>
                &times;
              </button>
            </div>
          )}
        </For>
        <div class="measurements-viewport-hint">
          {t('viewports.hint') || 'Viewports are highlighted while a measure tool is active.'}
        </div>
      </div>

      {/* ── Legend Section ── */}
      <div class="measurements-section" id="measurements-legend">
        <div class="measurements-section-header">
          <span>{t('measurements.legend', { defaultValue: 'Legend' })}</span>
          <span class="measurements-count">{legendRows().length}</span>
        </div>
        <div class="measurements-legend-scope" role="radiogroup"
          aria-label={t('measurements.legend', { defaultValue: 'Legend' })}>
          <label>
            <input type="radio" name="legend-scope" checked={legendScope() === 'page'}
              onChange={() => setLegendScope('page')} />
            {t('measurements.legendPage', { defaultValue: 'This page' })}
          </label>
          <label>
            <input type="radio" name="legend-scope" checked={legendScope() === 'document'}
              onChange={() => setLegendScope('document')} />
            {t('measurements.legendDocument', { defaultValue: 'Whole document' })}
          </label>
        </div>
        <div class="measurements-viewport-actions">
          <button type="button" class="measurements-viewport-btn" id="measurements-place-legend"
            title={t('measurements.legendPlaceTitle', { defaultValue: 'Place the legend as a table on this page' })}
            disabled={legendRows().length === 0} onClick={placeLegend}>
            {t('measurements.legendPlace', { defaultValue: 'Place on page' })}
          </button>
        </div>
        <Show when={legendRows().length === 0}>
          <div class="measurements-empty">{t('measurements.noMeasurements') || 'No measurements yet'}</div>
        </Show>
        <For each={legendRows()}>
          {(row) => (
            <div class="measurements-item measurements-legend-row" data-legend-type={row.type}>
              <span class="measurements-legend-swatch" style={{ background: row.color }} aria-hidden="true" />
              <span class="measurements-item-info">
                <span class="measurements-item-name">{row.subject || typeName(row.type)}</span>
                <span class="measurements-item-detail">
                  {row.subject ? `${typeName(row.type)} \u2022 ` : ''}
                  {t('measurements.legendCountValue', { count: row.count, defaultValue: `${row.count}\u00D7` })}
                </span>
              </span>
              <span class="measurements-group-total measurements-legend-total">
                {legendTotalText(row, formatMeasurement, legendLabels())}
              </span>
            </div>
          )}
        </For>
      </div>

      {/* ── Raceway schedule Section ── */}
      <Show when={hasRaceways()}>
        <div class="measurements-section" id="measurements-raceway-schedule">
          <div class="measurements-section-header">
            <span>{rt('title', 'Raceway schedule')}</span>
            <span class="measurements-count">{racewayRows().length}</span>
          </div>
          <div class="measurements-legend-scope" role="radiogroup" aria-label={rt('title', 'Raceway schedule')}>
            <label>
              <input type="radio" name="raceway-schedule-scope" checked={racewayScope() === 'page'}
                onChange={() => setRacewayScope('page')} />
              {t('measurements.legendPage', { defaultValue: 'This page' })}
            </label>
            <label>
              <input type="radio" name="raceway-schedule-scope" checked={racewayScope() === 'document'}
                onChange={() => setRacewayScope('document')} />
              {t('measurements.legendDocument', { defaultValue: 'Whole document' })}
            </label>
          </div>
          <div class="measurements-viewport-actions">
            <button type="button" class="measurements-viewport-btn" id="measurements-place-raceway-schedule"
              title={rt('placeTitle', 'Place the raceway schedule as a table on this page')}
              disabled={racewayRows().length === 0} onClick={placeRacewaySchedule}>
              {rt('place', 'Place on page')}
            </button>
          </div>
          <Show when={racewayRows().length === 0}>
            <div class="measurements-empty">{rt('none', 'No raceway runs on this page')}</div>
          </Show>
          <For each={racewayRows()}>
            {(row) => (
              <div class="measurements-item measurements-legend-row measurements-raceway-row"
                data-raceway-kind={row.kind} data-raceway-tag={row.tag}>
                <span class="measurements-legend-swatch" style={{ background: row.color }} aria-hidden="true" />
                <span class="measurements-item-info">
                  <span class="measurements-item-name">{row.tag ? `${row.tag} \u2022 ${row.size}` : row.size}</span>
                  <span class="measurements-item-detail">
                    {rt('runsValue', `${row.count}\u00D7`, { count: row.count })}
                    {row.fittings.length ? ` \u2022 ${fittingsText(row.fittings)}` : ''}
                    {row.bendMax != null ? ` \u2022 ${rt('bendsValue', `Bends ${racewayBendText(row)}`, { value: racewayBendText(row) })}` : ''}
                  </span>
                </span>
                <span class="measurements-group-total measurements-legend-total"
                  classList={{ 'measurements-raceway-over': row.over360 }}
                  title={row.over360 ? rt('over360', 'Over 360° between pull points') : undefined}>
                  {racewayLengthText(row, formatMeasurement, legendLabels())}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* ── Measurements Section ── */}
      <div class="measurements-section">
        <div class="measurements-section-header">
          <span>{t('measurements.measurements') || 'Measurements'}</span>
          <span class="measurements-count">{measurements().length}</span>
        </div>
        <div class="measurements-viewport-actions">
          {/* the external editor: Dynamic Fill also starts from the Measurements panel. */}
          <button type="button" class="measurements-viewport-btn" id="measurements-dynamic-fill"
            title={t('measurements.dynamicFillTitle') || 'Fill a closed region of the drawing and measure it (J)'}
            disabled={!getActiveDocument()}
            onClick={() => import('../../../commands/index.js')
              .then(() => import('../../../commands/registry.js'))
              .then((m) => m.runCommand('tools.measure.dynamicFill'))}>
            {t('measurements.dynamicFill') || 'Dynamic Fill'}
          </button>
        </div>
        <Show when={measurements().length === 0}>
          <div class="measurements-empty">{t('measurements.noMeasurements') || 'No measurements yet'}</div>
        </Show>
        <For each={Object.entries(groupedMeasurements())}>
          {([type, items]) => (
            <div class="measurements-group">
              <div class="measurements-group-header">
                <span>{t(`types.${type}`, { defaultValue: typeLabels[type] || type })}</span>
                <span class="measurements-group-total">{totals()[type]}</span>
              </div>
              <For each={items}>
                {(m) => (
                  <div class="measurements-item" classList={{ selected: getActiveDocument()?.selectedAnnotation?.id === m.id }}>
                    <button type="button" class="measurements-item-select"
                      aria-pressed={getActiveDocument()?.selectedAnnotation?.id === m.id}
                      onClick={() => navigateTo(m)}>
                      <span class="measurements-item-icon">{typeIcons[measureKindType(m)] || '\u2022'}</span>
                      <span class="measurements-item-info">
                        <span class="measurements-item-name">{m.label || m.measureText || 'Measurement'}</span>
                        <span class="measurements-item-detail">
                          Page {m.page}
                          {m.measureText ? ' \u2022 ' + m.measureText : ''}
                        </span>
                      </span>
                    </button>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
