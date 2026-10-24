#!/usr/bin/env python3
"""Onafhankelijke controle van een DXF-export tegen de bron-PDF.

De referentie komt uit PDFium (pypdfium2): paden en tekst in de pagina-inhoud,
inclusief formulier-XObjects, zonder annotaties. De DXF wordt gelezen met
ezdxf, dus het teruglezen is onafhankelijk van de schrijver.

Twee metingen, beide in tekeneenheden (mm in de uitvoer):

  A. volledigheid  - elk eindpunt uit de PDF ligt op een DXF-segment;
  B. geen ruis     - elk DXF-hoekpunt ligt op een PDF-segment (krommen in de
                     referentie fijn bemonsterd).

De grens is de acceptatie-eis uit issue #400: 0,1 mm op papier (maal de
schaalnoemer bij export op ware grootte).

Gebruik:
  python verify_export.py <pdf> <pagina> <dxf> [--scale N] [--tolerance 0.1]
                          [--json uit.json] [--texts]
"""
import argparse
import json
import sys
from pathlib import Path

import ezdxf
import numpy as np
from shapely import STRtree, LineString, Point as ShPoint

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "open-pdf-studio" / "scripts"))

import pdfium_measure


def reference_geometry(page, scale, skip_page_fills=True):
    """Eindpunten en segmenten uit PDFium, omgezet naar uitvoer-mm (y omhoog)."""
    return pdfium_measure.path_geometry(page, scale, skip_page_fills)


def dxf_geometry(path):
    doc = ezdxf.readfile(path)
    msp = doc.modelspace()
    vertices, segments, counts = [], [], {}
    for e in msp:
        kind = e.dxftype()
        counts[kind] = counts.get(kind, 0) + 1
        if kind == "LINE":
            a = (e.dxf.start.x, e.dxf.start.y)
            b = (e.dxf.end.x, e.dxf.end.y)
            vertices += [a, b]
            segments.append((a, b))
        elif kind == "LWPOLYLINE":
            pts = [(p[0], p[1]) for p in e.get_points("xy")]
            vertices += pts
            segments += list(zip(pts, pts[1:]))
            if e.closed and len(pts) > 2:
                segments.append((pts[-1], pts[0]))
        elif kind == "HATCH":
            for boundary in e.paths:
                pts = [(v[0], v[1]) for v in getattr(boundary, "vertices", [])]
                vertices += pts
                if len(pts) > 1:
                    segments += list(zip(pts, pts[1:] + pts[:1]))
        elif kind == "WIPEOUT":
            # Maskering: een dekkend vlak in papierkleur. De grens is gesloten,
            # dus het laatste punt is het eerste.
            pts = [(v.x, v.y) for v in e.boundary_path_wcs()]
            if len(pts) > 2 and pts[0] == pts[-1]:
                pts = pts[:-1]
            vertices += pts
            if len(pts) > 1:
                segments += list(zip(pts, pts[1:] + pts[:1]))
        elif kind == "SPLINE":
            pts = [(p[0], p[1]) for p in e.control_points]
            # Alleen de Bézier-eindpunten (elke derde) liggen op de kromme.
            vertices += pts[::3]
            flat = [(p.x, p.y) for p in e.flattening(0.001)]
            segments += list(zip(flat, flat[1:]))
    layers = [layer.dxf.name for layer in doc.layers]
    return vertices, segments, counts, layers, doc


def distances(points, segments):
    """Afstand van elk punt tot het dichtstbijzijnde segment."""
    if not points or not segments:
        return np.array([])
    lines = [LineString(s) if s[0] != s[1] else ShPoint(s[0]) for s in segments]
    tree = STRtree(lines)
    pts = [ShPoint(p) for p in points]
    _, dist = tree.query_nearest(pts, return_distance=True, all_matches=False)
    return np.asarray(dist)


def summarize(name, dist, tolerance):
    if dist.size == 0:
        return {"name": name, "count": 0}
    over = int((dist > tolerance).sum())
    return {
        "name": name,
        "count": int(dist.size),
        "max": float(dist.max()),
        "p999": float(np.percentile(dist, 99.9)),
        "mean": float(dist.mean()),
        "over_tolerance": over,
    }


def compare_texts(page, doc, scale, tolerance):
    """Tekst: het invoegpunt van elke TEXT moet samenvallen met de
    basislijn-oorsprong van een teken in PDFium dat gelijk is aan het eerste
    teken van die tekst. Hoogte wordt vergeleken met de lettergrootte, de hoek
    met de schrijfrichting."""
    chars = pdfium_measure.text_chars(page, scale)
    texts = [e for e in doc.modelspace() if e.dxftype() == "TEXT"]
    if not texts or not chars:
        return {"dxf_texts": len(texts), "pdf_chars": len(chars)}
    tree = STRtree([ShPoint(c[0]) for c in chars])
    pos, ratio, ang, wrong_char = [], [], [], 0
    for t in texts:
        p = ShPoint(t.dxf.insert.x, t.dxf.insert.y)
        char = chars[tree.nearest(p)]
        pos.append(p.distance(ShPoint(char[0])))
        wrong_char += char[1] != t.dxf.text[:1]
        ratio.append(t.dxf.height / char[2])
        ang.append(abs((t.dxf.rotation - char[3] + 180) % 360 - 180))
    pos, ratio, ang = np.array(pos), np.array(ratio), np.array(ang)
    return {
        "dxf_texts": len(texts),
        "pdf_chars": len(chars),
        "insert_max": float(pos.max()),
        "insert_over_tolerance": int((pos > tolerance).sum()),
        "first_char_mismatch": int(wrong_char),
        "height_ratio_min": float(ratio.min()),
        "height_ratio_median": float(np.median(ratio)),
        "height_ratio_max": float(ratio.max()),
        "angle_max_deg": float(ang.max()),
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("page", type=int, help="1-gebaseerd")
    ap.add_argument("dxf")
    ap.add_argument("--scale", type=float, default=1.0, help="schaalnoemer N van 1:N")
    ap.add_argument("--tolerance", type=float, default=0.1, help="mm op papier")
    ap.add_argument("--json")
    ap.add_argument("--texts", action="store_true")
    ap.add_argument("--keep-page-fills", action="store_true",
                    help="paginavullende vlakken in de referentie laten staan (export met --keep-page-fills)")
    ap.add_argument("--keep-annotations", action="store_true",
                    help="annotaties in de referentie laten staan")
    args = ap.parse_args()

    tolerance = args.tolerance * args.scale
    # PDFium leest paden uit de pagina-inhoud. Annotaties zitten daar niet in,
    # dus het bestand hoeft niet aangepast te worden. Met --keep-annotations
    # worden ze in het geheugen platgeslagen tot inhoud, als het document een
    # formulieromgeving heeft.
    doc_pdf = pdfium_measure.open_pdf(args.pdf)
    try:
        doc_pdf.init_forms()
        if args.page < 1 or args.page > len(doc_pdf):
            raise SystemExit(f"pagina {args.page} valt buiten het document ({len(doc_pdf)} pagina's)")
        page = doc_pdf[args.page - 1]
        annotations = pdfium_measure.annot_count(page)
        included = False
        if args.keep_annotations and annotations and page.formenv:
            page.flatten()
            page = doc_pdf[args.page - 1]
            included = True
            annotations = 0
        ref_points, ref_segments, ref_counts = reference_geometry(page, args.scale, not args.keep_page_fills)
        dxf_vertices, dxf_segments, dxf_counts, layers, doc = dxf_geometry(args.dxf)

        a = summarize("pdf-eindpunt -> dxf-segment", distances(ref_points, dxf_segments), tolerance)
        b = summarize("dxf-hoekpunt -> pdf-segment", distances(dxf_vertices, ref_segments), tolerance)
        result = {
            "pdf": args.pdf,
            "page": args.page,
            "rotation": pdfium_measure.rotation(page),
            "mediabox": list(pdfium_measure.mediabox(page)),
            "scale": args.scale,
            "tolerance": tolerance,
            "annotations_removed_from_reference": annotations,
            "annotations_included": included,
            "reference": ref_counts,
            "dxf_entities": dxf_counts,
            "dxf_layers": len(layers),
            "dxfversion": doc.dxfversion,
            "insunits": doc.header.get("$INSUNITS"),
            "completeness": a,
            "no_noise": b,
        }
        if args.texts:
            result["texts"] = compare_texts(page, doc, args.scale, tolerance)
        ok = a.get("over_tolerance", 0) == 0 and b.get("over_tolerance", 0) == 0
        if args.texts:
            ok = ok and result["texts"].get("insert_over_tolerance", 0) == 0
        result["ok"] = ok
        print(json.dumps(result, indent=2, ensure_ascii=False))
        if args.json:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
        return 0 if ok else 1
    finally:
        doc_pdf.close()


if __name__ == "__main__":
    sys.exit(main())
