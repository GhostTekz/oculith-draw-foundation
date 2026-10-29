// A version 2 package may add styled aliases of the editor's ordinary box
// tool. Every alias still creates a core box annotation with the core saver.
const MAX_TOOLS = 16;
const MAX_ID = 160;
const COLOR = /^#[0-9a-f]{6}$/i;
const STYLE_FIELDS = new Set(['color', 'strokeColor', 'fillColor', 'lineWidth', 'opacity', 'subject']);

export function validateBoxTools(packageId, tools) {
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) throw new Error('boxTools must be an array of at most 16 tools');
  const prefix = `addon:${packageId}:`;
  const ids = new Set();
  return tools.map((tool) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(tool))
        || Object.keys(tool).some((key) => !['id', 'style'].includes(key))
        || typeof tool.id !== 'string' || tool.id.length > MAX_ID
        || !tool.id.startsWith(prefix) || !/^[a-z][a-z0-9._-]{0,63}$/.test(tool.id.slice(prefix.length))
        || ids.has(tool.id)) {
      throw new Error('boxTools need unique package-scoped tool IDs');
    }
    ids.add(tool.id);
    const style = tool.style === undefined ? {} : tool.style;
    if (!style || typeof style !== 'object' || Array.isArray(style)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(style))
        || Object.keys(style).some((key) => !STYLE_FIELDS.has(key))) {
      throw new Error('boxTools style has unsupported fields');
    }
    for (const key of ['color', 'strokeColor', 'fillColor']) {
      if (style[key] != null && (typeof style[key] !== 'string' || !COLOR.test(style[key]))) {
        throw new Error(`boxTools ${key} must be a six-digit hex color`);
      }
    }
    if (style.lineWidth != null && (!Number.isFinite(style.lineWidth) || style.lineWidth <= 0 || style.lineWidth > 50)) {
      throw new Error('boxTools lineWidth must be between 0 and 50');
    }
    if (style.opacity != null && (!Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1)) {
      throw new Error('boxTools opacity must be between 0 and 1');
    }
    if (style.subject != null && (typeof style.subject !== 'string' || !style.subject.trim() || style.subject.length > 120)) {
      throw new Error('boxTools subject must be nonempty and at most 120 characters');
    }
    const normalized = { ...style };
    if (normalized.color && !normalized.strokeColor) normalized.strokeColor = normalized.color;
    if (normalized.strokeColor && !normalized.color) normalized.color = normalized.strokeColor;
    return { id: tool.id, style: normalized };
  });
}
