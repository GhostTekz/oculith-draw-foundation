export default function RibbonGroup(props) {
  return (
    <div class={`ribbon-group${props.wide ? ' ribbon-group-wide' : ''}${props.compact ? ' ribbon-group-compact' : ''}${props.iconOnly ? ' ribbon-group-icon-only' : ''}`}>
      <div class="ribbon-group-content">
        {props.children}
      </div>
      <div class="ribbon-group-label">{props.label || ''}</div>
    </div>
  );
}
