import { createSignal, For, onMount, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';

export default function LanguageSelect(props) {
  const [open, setOpen] = createSignal(false);
  const [filter, setFilter] = createSignal('');
  const [style, setStyle] = createSignal({});
  let wrapperRef, dropdownRef, searchRef;

  const displayLabel = () => {
    const val = props.value();
    const opt = props.options.find(o => o.value === val);
    return opt ? opt.label : String(val);
  };

  const filtered = () => {
    const q = filter().toLowerCase();
    if (!q) return props.options;
    return props.options.filter(o => o.label.toLowerCase().includes(q));
  };

  function position() {
    if (!wrapperRef) return;
    const rect = wrapperRef.getBoundingClientRect();
    const maxH = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 200 && rect.top > spaceBelow;
    const s = {
      position: 'fixed',
      left: (rect.left - 1) + 'px',
      width: '260px',
      'overflow-y': 'auto',
    };
    if (openUp) {
      s.bottom = (window.innerHeight - rect.top) + 'px';
      s['max-height'] = Math.min(rect.top - 4, maxH) + 'px';
    } else {
      s.top = rect.bottom + 'px';
      s['max-height'] = Math.min(spaceBelow - 4, maxH) + 'px';
    }
    setStyle(s);
  }

  function toggle(e) {
    e.preventDefault();
    const willOpen = !open();
    if (willOpen) {
      setFilter('');
      position();
    }
    setOpen(willOpen);
    if (willOpen) {
      requestAnimationFrame(() => {
        if (searchRef) searchRef.focus();
        if (dropdownRef) {
          const sel = dropdownRef.querySelector('.selected');
          if (sel) sel.scrollIntoView({ block: 'nearest' });
        }
      });
    }
  }

  function select(val) {
    props.setValue(val);
    setOpen(false);
  }

  function handleDocClick(e) {
    if (wrapperRef && !wrapperRef.contains(e.target) &&
        dropdownRef && !dropdownRef.contains(e.target)) {
      setOpen(false);
    }
  }

  onMount(() => document.addEventListener('mousedown', handleDocClick));
  onCleanup(() => document.removeEventListener('mousedown', handleDocClick));

  return (
    <div class="pref-combo" style={props.style} ref={wrapperRef}>
      <span class="pref-select-display" onMouseDown={toggle}>{displayLabel()}</span>
      <button type="button" class="pref-combo-arrow" tabIndex={-1} onMouseDown={toggle}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      <Portal>
        <div class="pref-combo-dropdown lang-select-dropdown" classList={{ show: open() }}
          style={style()} ref={dropdownRef}>
          <div class="lang-select-search">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search..."
              value={filter()}
              onInput={e => setFilter(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
            />
          </div>
          <div class="lang-select-list">
            <For each={filtered()}>
              {(opt) => (
                <div
                  class="pref-combo-option"
                  classList={{ selected: props.value() === opt.value }}
                  onMouseDown={() => select(opt.value)}
                >
                  {opt.label}
                </div>
              )}
            </For>
            {filtered().length === 0 && <div class="pref-combo-option" style="opacity:0.5;pointer-events:none">No results</div>}
          </div>
        </div>
      </Portal>
    </div>
  );
}
