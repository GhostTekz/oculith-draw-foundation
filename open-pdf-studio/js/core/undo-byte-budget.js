export const MAX_UNDO_PDF_BYTES = 256 * 1024 * 1024;

function addPdfBytes(command, buffers) {
  if (!command) return;
  if (command.type === 'compound') {
    for (const child of command.commands || []) addPdfBytes(child, buffers);
    return;
  }
  if (command.type !== 'pageStructure') return;
  for (const value of [command.oldBytes, command.newBytes]) {
    const buffer = ArrayBuffer.isView(value) ? value.buffer : value;
    if (buffer instanceof ArrayBuffer) buffers.add(buffer);
  }
}

export function retainedUndoPdfBytes(stack) {
  const buffers = new Set();
  for (const command of stack) addPdfBytes(command, buffers);
  let bytes = 0;
  for (const buffer of buffers) bytes += buffer.byteLength;
  return bytes;
}

/** Keep the newest operation undoable even if its own PDF is over budget. */
export function trimUndoStack(stack, maxCommands, maxPdfBytes = MAX_UNDO_PDF_BYTES) {
  let removed = 0;
  while (stack.length > 1 && (stack.length > maxCommands
      || retainedUndoPdfBytes(stack) > maxPdfBytes)) {
    stack.shift();
    removed++;
  }
  return removed;
}
