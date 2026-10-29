export function createAddon() {
  return {
    apiVersion: 2,
    id: 'sample.second',
    fileCommands: [{ id: 'sample.second.command', label: 'Second command', category: 'file',
      run: () => { globalThis.__secondCommandRan = true; } }],
    fileMenuItems: ['sample.second.command'],
    toolbarItems: [{ id: 'sample-second-button', title: 'Second', icon: '', run: () => {} }],
    pdf: {
      catalogKeys: ['ODX_sample_2esecond_State'],
      annotationKeys: ['ODX_sample_2esecond_Markup'],
      applyCatalog(doc, fields) { doc.sampleSecondState = fields.ODX_sample_2esecond_State || null; },
      catalogForSave(doc) { return doc.sampleSecondState ? { ODX_sample_2esecond_State: doc.sampleSecondState } : {}; },
      decorateAnnotation(model, fields) { return { ...model, sampleSecondMarkup: fields.ODX_sample_2esecond_Markup || null }; },
      annotationForSave(model) { return model.sampleSecondMarkup ? { ODX_sample_2esecond_Markup: model.sampleSecondMarkup } : {}; },
    },
  };
}
