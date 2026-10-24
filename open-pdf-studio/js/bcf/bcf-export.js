// Pure BCF 2.1 export: annotations (+ optional snapshots) → .bcfzip bytes.
//
// Archive layout written (BCF 2.1):
//
//   bcf.version                     — <Version VersionId="2.1">
//   project.bcfp                    — <ProjectExtension><Project>
//   {topic-guid}/markup.bcf         — <Markup><Topic><Comment*><Viewpoints*>
//   {topic-guid}/snapshot.png       — per-topic snapshot (when provided)
//   {topic-guid}/viewpoint.bcfv     — minimal <VisualizationInfo> (2D, no camera)
//   {topic-guid}/markup-opds.json   — private lossless annotation payload
//
// Pure module (no browser/app imports). Snapshots are passed in as a
// Map<annotationId, Uint8Array(PNG)> so this stays unit-testable; the UI glue
// renders them.

import { zipStore } from './bcf-zip.js';
import { escapeXml } from './bcf-xml.js';
import { annotationToTopic, genGuid } from './bcf-mapping.js';
import { edition } from '../editions/active.js';

function versionXml() {
  return '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<Version VersionId="2.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
    '  <DetailedVersion>2.1</DetailedVersion>\n' +
    '</Version>\n';
}

function projectXml(projectName, projectId) {
  return '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<ProjectExtension xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
    `  <Project ProjectId="${escapeXml(projectId)}">\n` +
    `    <Name>${escapeXml(projectName)}</Name>\n` +
    '  </Project>\n' +
    '  <ExtensionSchema></ExtensionSchema>\n' +
    '</ProjectExtension>\n';
}

// Minimal 2D viewpoint: BCF requires a VisualizationInfo document but we carry
// no 3D camera. An OrthogonalCamera with a neutral view keeps strict readers
// happy without implying a real 3D position.
function viewpointBcfv(guid) {
  return '<?xml version="1.0" encoding="utf-8"?>\n' +
    `<VisualizationInfo Guid="${escapeXml(guid)}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    '  <OrthogonalCamera>\n' +
    '    <CameraViewPoint><X>0</X><Y>0</Y><Z>1</Z></CameraViewPoint>\n' +
    '    <CameraDirection><X>0</X><Y>0</Y><Z>-1</Z></CameraDirection>\n' +
    '    <CameraUpVector><X>0</X><Y>1</Y><Z>0</Z></CameraUpVector>\n' +
    '    <ViewToWorldScale>1</ViewToWorldScale>\n' +
    '  </OrthogonalCamera>\n' +
    '</VisualizationInfo>\n';
}

function markupXml(topic, opts) {
  const { hasSnapshot, viewpointGuid } = opts;
  let x = '<?xml version="1.0" encoding="utf-8"?>\n';
  x += '<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n';
  x += `  <Topic Guid="${escapeXml(topic.guid)}" TopicType="${escapeXml(topic.topicType)}" TopicStatus="${escapeXml(topic.topicStatus)}">\n`;
  x += `    <Title>${escapeXml(topic.title)}</Title>\n`;
  if (topic.priority) x += `    <Priority>${escapeXml(topic.priority)}</Priority>\n`;
  for (const label of topic.labels || []) x += `    <Labels>${escapeXml(label)}</Labels>\n`;
  x += `    <CreationDate>${escapeXml(topic.creationDate)}</CreationDate>\n`;
  x += `    <CreationAuthor>${escapeXml(topic.creationAuthor)}</CreationAuthor>\n`;
  if (topic.modifiedDate) x += `    <ModifiedDate>${escapeXml(topic.modifiedDate)}</ModifiedDate>\n`;
  if (topic.description) x += `    <Description>${escapeXml(topic.description)}</Description>\n`;
  x += '  </Topic>\n';

  for (const c of topic.comments || []) {
    x += `  <Comment Guid="${escapeXml(c.guid || genGuid())}">\n`;
    x += `    <Date>${escapeXml(c.date)}</Date>\n`;
    x += `    <Author>${escapeXml(c.author)}</Author>\n`;
    x += `    <Comment>${escapeXml(c.comment)}</Comment>\n`;
    if (hasSnapshot) x += `    <Viewpoint Guid="${escapeXml(viewpointGuid)}"/>\n`;
    x += '  </Comment>\n';
  }

  if (hasSnapshot) {
    x += `  <Viewpoints Guid="${escapeXml(viewpointGuid)}">\n`;
    x += '    <Viewpoint>viewpoint.bcfv</Viewpoint>\n';
    x += '    <Snapshot>snapshot.png</Snapshot>\n';
    x += '  </Viewpoints>\n';
  }

  x += '</Markup>\n';
  return x;
}

/**
 * Build BCF archive bytes from a list of annotations.
 * @param {Array<object>} annotations
 * @param {object} [options]
 * @param {string} [options.projectName]
 * @param {Map<string, Uint8Array>} [options.snapshots]  annotationId → PNG bytes
 * @returns {Uint8Array} .bcfzip bytes
 */
export function buildBcfZip(annotations, options = {}) {
  const projectName = options.projectName || `${edition.productName} project`;
  const snapshots = options.snapshots || new Map();

  const entries = [
    { name: 'bcf.version', data: versionXml() },
    { name: 'project.bcfp', data: projectXml(projectName, genGuid()) },
  ];

  for (const ann of annotations) {
    const topic = annotationToTopic(ann);
    const dir = topic.guid;
    const snapshot = snapshots.get(ann.id);
    const hasSnapshot = snapshot instanceof Uint8Array && snapshot.length > 0;
    const viewpointGuid = hasSnapshot ? genGuid() : null;

    entries.push({
      name: `${dir}/markup.bcf`,
      data: markupXml(topic, { hasSnapshot, viewpointGuid }),
    });
    // Private lossless payload (page number lives inside the annotation).
    entries.push({
      name: `${dir}/markup-opds.json`,
      data: JSON.stringify({ page: topic.page, annotation: ann }),
    });
    if (hasSnapshot) {
      entries.push({ name: `${dir}/snapshot.png`, data: snapshot });
      entries.push({ name: `${dir}/viewpoint.bcfv`, data: viewpointBcfv(viewpointGuid) });
    }
  }

  return zipStore(entries, new Date());
}
