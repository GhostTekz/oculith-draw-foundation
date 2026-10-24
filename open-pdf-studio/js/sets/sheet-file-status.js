export async function inspectSheetFile(filePath, grantScope, exists) {
  try {
    await grantScope(filePath);
    return await exists(filePath) ? 'Present' : 'Missing';
  } catch {
    return 'Unavailable';
  }
}

export async function inspectHistoricalFiles(register, inspect) {
  const paths = [...new Set(register.sheets.flatMap(sheet => sheet.history.map(item => item.filePath)))];
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, await inspect(path)])));
}
