# File format

Oculith Draw Foundation has no file format of its own for drawings. It reads and writes ordinary PDF files. This page lists what it writes into a PDF, and what another PDF reader sees.

## Principles

- **Standard first.** Every markup is a standard PDF annotation (ISO 32000) with a normal appearance stream (`/AP /N`). Any reader can show and print it.
- **Private keys for the rest.** Data that has no standard key goes into private keys whose names start with `OPS_`. Other readers ignore them. Oculith Draw reads them back to restore the markup exactly.
- **Untouched objects stay the same.** A save rewrites only what changed. A markup from another program that you did not touch keeps its object and every key. An edited markup keeps its object number and its place in `/Annots`.
- **Bounded input.** PDFs are untrusted. Every private value has a size limit and is validated on read. A malformed value is ignored.
- **Text values.** Structured private values are JSON in a PDF text string, usually UTF-16 hex. Names and labels are PDF text strings.

## Markups as annotations

`OPS_Subtype` on the annotation names the app's own type when the PDF subtype is shared by several types.

| Markup | PDF subtype | Notes |
|---|---|---|
| Rectangle | `/Square` | |
| Ellipse, circle | `/Circle` | |
| Line, arrow, dimension | `/Line` | Heads in `/LE` |
| Pen | `/Ink` | |
| Polyline | `/PolyLine` | |
| Arc, spline, curved arrow | `/PolyLine` | `OPS_Subtype` `arc`, `spline`, `splineArrow`; arc data in `OPS_ArcRadius`, `OPS_StartAngle`, `OPS_EndAngle`, `OPS_ArcBulges`, `OPS_ArcFlags` |
| Polygon, cloud, Cloud+ | `/Polygon` | `OPS_Subtype` `cloud` or `cloudPolyline` for clouds |
| Hatch (filled area) | `/Polygon` | `OPS_Subtype filledArea`, holes in `OPS_Holes` |
| Text box, callout, typewriter | `/FreeText` | Callouts use `/IT /FreeTextCallout`, typewriters `/IT /FreeTextTypeWriter`; rich text in `/RC`, text style in `/DS` |
| Note, flag | `/Text` | A flag uses the `/Flag` icon |
| Text highlight, underline, strikeout, squiggly | Text markup subtypes | Quad points along the text |
| Stamp, image, signature | `/Stamp` | |
| Hyperlink | `/Link` | `/URI`, `/Dest` or `/GoToR` action |
| File attachment | `/FileAttachment` | `/Name /PushPin`, the file embedded through `/FS` |
| Count | `/Square` | `OPS_Subtype count` |
| Length | `/Line` | `/IT /LineDimension` with `/Measure` |
| Area, volume | `/Polygon` | `/IT /PolygonDimension` |
| Perimeter, polylength, angle, raceway run | `/PolyLine` | `/IT /PolyLineDimension` where it applies |
| Quantity or legend table | `/Square` | `OPS_Subtype scheduleTable` |
| Parametric symbol | `/Square` | `OPS_Subtype parametricSymbol` |

Every written markup also gets `/P` (its page), `/NM` (a unique name, kept from the file or created once), `/T` (author), `/CreationDate` and `/M`, and `/Subj` when it has a subject. The comment is `/Contents`. For a measurement, `/Contents` holds the measured text.

## Private keys on annotations

### General

| Key | Meaning |
|---|---|
| `OPS_Subtype` | The app's markup type |
| `OPS_MarkupIdV1` | Durable id of a rectangle, ellipse, line or arrow |
| `OPS_FillOpacity` | Fill opacity separate from stroke opacity |
| `OPS_NoStroke` | A shape drawn without a border |
| `OPS_LineHeads`, `OPS_HeadSize` | Line ending styles and size |
| `OPS_FontSize` | Label size of a measurement |
| `OPS_LineStyle` | A custom line style definition, so the style survives on another machine |
| `OPS_Hatch`, `OPS_HatchPattern`, `OPS_HatchAngle`, `OPS_HatchScale`, `OPS_HatchColor`, `OPS_HatchDef` | Hatch settings; `OPS_HatchDef` carries an imported `.pat` pattern |
| `OPS_GroupPathV1` | Nested group levels, beside the standard `/IRT` group links and `/GroupNesting` name |
| `OPS_CaptionTemplateV1` | The markup's own caption template |
| `OPS_CarriedFromV1` | Where a slip-sheeted markup came from: sheet, revision, path, page, source id |
| `OPS_AssemblyIdV1` | The assembly attached to a count or length |
| `OPS_IfcCategory`, `OPS_IfcPredefined` | IFC class for the IFC report |

### Measurements and scale

| Key | Meaning |
|---|---|
| `OPS_MeasureValue`, `OPS_MeasureUnit` | The computed value and its unit |
| `OPS_Holes` | Hole rings of an area |
| `OPS_MeasureExtra` | JSON for extra measurement kinds: polylength, volume, arc, raceway settings, fittings, bend totals, conductor fill, and the run id that branches refer to |
| `OPS_NoLabel` | The measurement draws no label |
| `OPS_PixelsPerUnit`, `OPS_ScaleRatio`, `OPS_Unit`, `OPS_Divisions`, `OPS_TotalUnits` | Scale regions and scale bars |

### Counts and symbols

| Key | Meaning |
|---|---|
| `OPS_CountCategory`, `OPS_CountNumber` | Count category and number |
| `OPS_MarkerStyle`, `OPS_SymbolId`, `OPS_SymbolSize`, `OPS_CountShowNumber` | A count drawn as a symbol |
| `OPS_Params` | Values of a parametric symbol |

A symbol count's appearance holds the symbol as vector paths and Helvetica text, with no image.

### Stamps and images

| Key | Meaning |
|---|---|
| `OPS_StampDesign` | JSON of the placed stamp: template id, name, colour, border, evaluated lines, image, size |
| `OPS_StampText`, `OPS_StampName` | Stamp text for search, and its name |
| `OPS_Crop`, `OPS_CropLeft`/`Right`/`Top`/`Bottom`, `OPS_Brightness`, `OPS_Contrast`, `OPS_Grayscale`, `OPS_TintColor` | Image adjustments |
| `OPS_LinkedPath` | The source path of a linked image |

### Custom column values

| Key | Column |
|---|---|
| `OPS_MarkupTextValue`, `OPS_MarkupTextValue2V1` | Text columns 1 and 2 |
| `OPS_MarkupChoiceValue`, `OPS_MarkupChoiceValue2V1` | Choice columns 1 and 2 (the selected label) |
| `OPS_MarkupNumberValue`, `OPS_MarkupNumberValue2V1` | Number columns 1 and 2 |
| `OPS_MarkupCheckmarkValue` | Checkmark column |

Formula results are computed when the list is built and are never stored on a markup.

### Capture and links

| Key | Meaning |
|---|---|
| `OPS_Capture` | References to the photos attached to the markup |
| `OPS_LinkPage`, `OPS_LinkFile` | Target page, and target file for a link to another PDF |
| `OPS_BatchLink` | The link was made by Batch Link, so Remove Batch Links may delete it |

### Layers

A markup on a markup layer carries the standard `/OC` key pointing at that layer's optional content group.

## Status and replies

A markup's review status is a standard reply: a `/Text` annotation with `/IRT` to the markup and `/State` and `/StateModel`. Replies are `/Text` annotations with `/IRT`. Other readers show both in their comment threads.

## Page entries

| Entry | Meaning |
|---|---|
| `/VP` viewport with `OPS_PageScale true` | The page scale: a standard `/Viewport` with a `/Measure` (`/RL`) dictionary, plus `OPS_Method` and `OPS_Precision`. Readers that support PDF measure dictionaries use the same scale |
| `/VP` viewport with `OPS_Viewport true` | A named viewport with its own scale: `/BBox`, `/Name`, `/Measure`, `OPS_Id`, `OPS_ScaleString`, `OPS_Units` |
| `OPS_Spaces` | The page's spaces: id, name, colour, outline path, parent, hidden |
| `OPS_Flattened` | The flatten record that lets Unflatten restore markups; absent when "allow unflatten" was off |

The app replaces only its own viewports (those marked `OPS_PageScale` or `OPS_Viewport`). Viewports written by other programs stay as they are. Space and viewport outlines are in default user space: the CropBox origin, without `/Rotate`.

## Catalog entries

| Key | Meaning |
|---|---|
| `OPS_MarkupTextColumn`, `OPS_MarkupTextColumn2V1` | Text column definitions |
| `OPS_MarkupChoiceColumnV1`, `OPS_MarkupChoiceColumnV2`, `OPS_MarkupChoiceColumn2V1`, `OPS_MarkupChoiceColumn2V2` | Choice column definitions; V2 adds the numeric value of each option, and V1 keeps a label-only copy for older readers |
| `OPS_MarkupNumberColumnV1`, `OPS_MarkupNumberColumn2V1` | Number column definitions |
| `OPS_MarkupCheckmarkColumnV1` | Checkmark column definition |
| `OPS_MarkupFormulaColumnV1`/`V2`/`V3` | The Formula column: name, source, multiplier, offset |
| `OPS_FormulaCaptionsV1` | Formula columns and caption templates from the Formulas dialog |
| `OPS_MarkupStatusSetV1` | The document's own status set |
| `OPS_ToolSequences` | Next value of each Tool Chest sequence, by prefix and suffix only |
| `OPS_AssembliesV1` | Assembly recipes: parts, quantities, units, unit prices |
| `OPS_StylePresets` | Saved style presets |
| `OPS_VectorSnippets` | Source data of pasted vector snippets |

Standard catalog entries the app writes or keeps:

- `/OCProperties`: one optional content group per markup layer, with visibility in `/D /OFF` and "not printable" as `/Usage /Print` plus a `/D /AS` print rule. Each group carries `OPS_LayerId`, `OPS_Color`, `OPS_Locked` and `OPS_Printable`. `/OCProperties /OPS_AnnotLayers` holds the panel order of the layers (empty ones included) and the current layer.
- `/Names /EmbeddedFiles`: the photos and attached files, so any reader lists them as attachments. Each photo's file specification carries `OPS_CaptureFileV1` with its id, size, date and markup.
- `/Outlines`: bookmarks. `/PageLabels`: page labels.

## Optional content (PDF layers)

The app keeps two kinds of optional content apart:

- **Markup layers**: groups that only markups point at with `/OC`. The app creates, renames, hides and deletes these.
- **Drawing layers**: groups that switch page content, such as CAD layers. The app keeps them unchanged.

A group written by another program that only markups use is adopted as a markup layer. It keeps its object; only what you change is written.

## What other readers see

| Item | In another PDF reader |
|---|---|
| Markups | Shown and printed from their appearance streams |
| Line styles, hatches, count symbols, stamps, raceway runs | Shown as drawn: the appearance holds the paths and Helvetica text |
| Measurements | Shown with their label; standard `/Measure` data where the reader supports it |
| Page scale and named viewports | Read from `/VP` by readers that support PDF measure viewports |
| Markup layers | Listed as layers that switch the markups |
| Hidden markups | Hidden (annotation Hidden flag) |
| Status and replies | In the comment thread |
| Photos and attached files | Listed as attachments; attached files show as push pins |
| Batch links | Working links, including links between files |
| Custom column values, captions, spaces, sequences, assemblies | Not shown; kept in private keys |
| Flattened markups | Part of the page content |

A count opens in other readers as a rectangle-type annotation with its drawn marker. A caption is drawn only by Oculith Draw; it is not in the appearance stream.

## Other files

Oculith Draw also reads and writes a few small JSON formats of its own:

- **Tool set file** (`.ocudraw-toolset`, `format: "ocudraw.tool-set-file"`): every Tool Chest tool type, up to 200 tools and 512 KB.
- **Portable tool set** (`format: "ocudraw.tool-set"`, versions 1 to 3): a strict exchange format for a subset of tool types, up to 50 tools and 64 KB.
- **Stamps** (`format: "ocudraw-stamps"`): user stamps.
- **Line styles** (`ocudraw.line-styles`, version 1): user line styles.
- **Compare plan** (`format: "ocudraw.compare-plan"`, version 1): the two document paths, page counts, alignment and confirmed page pairs. It holds no PDF bytes or results.
- **IFC report** (`.ifcreport`): the source PDF and every annotation mapped onto IFC classes; see the [user guide](GUIDE.md#ifc-report).

Each import is validated in full before anything changes. Extra fields or invalid values reject the file.
