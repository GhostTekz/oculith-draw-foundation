"""Controleert een PDF die uit de DWG/DXF-import komt.

Leest met PDFium (pypdfium2) de paginamaat, het getekende werk en de tekst,
en met qpdf de lagen (OCG's) en de meetschaal (`/VP` + `/Measure`). Maakt er
een afbeelding van om naar te kijken.

    python verify_import.py <bestand.pdf> [--png <uit.png>] [--dpi 100] [--json]
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "open-pdf-studio" / "scripts"))

import pdfium_measure as meting


def _qpdf_json(path):
    result = subprocess.run(
        ["qpdf", "--json", str(path)],
        capture_output=True,
    )
    if result.returncode not in (0, 3) or not result.stdout:
        detail = result.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(detail[:400] or f"qpdf stopte met code {result.returncode}")
    return json.loads(result.stdout), result.returncode == 3


def _pdf_text(value):
    if isinstance(value, str) and len(value) > 2 and value[1] == ":" and value[0] in "ub":
        return value[2:]
    return value if isinstance(value, str) else ""


def _refs(value):
    found = []
    if isinstance(value, str) and value.endswith(" R"):
        found.append(value)
    elif isinstance(value, list):
        for item in value:
            found.extend(_refs(item))
    elif isinstance(value, dict):
        for item in value.values():
            found.extend(_refs(item))
    return found


def _layers(data):
    objects = data["qpdf"][1]
    properties = None
    for obj in objects.values():
        value = obj.get("value")
        if isinstance(value, dict) and value.get("/Type") == "/Catalog" and "/OCProperties" in value:
            properties = value["/OCProperties"]
            break
    if not isinstance(properties, dict):
        return []
    config = properties.get("/D") if isinstance(properties.get("/D"), dict) else {}
    refs = []
    for ref in _refs(config.get("/Order")) + _refs(properties.get("/OCGs")):
        if ref not in refs:
            refs.append(ref)
    base_off = config.get("/BaseState") == "/OFF"
    turned_on = set(_refs(config.get("/ON")))
    turned_off = set(_refs(config.get("/OFF")))
    layers = []
    for ref in refs:
        value = objects.get("obj:" + ref, {}).get("value")
        if not isinstance(value, dict) or value.get("/Type") != "/OCG":
            continue
        enabled = ref in turned_on if base_off else ref not in turned_off
        layers.append({"text": _pdf_text(value.get("/Name", "")), "on": enabled})
    return layers


def _viewports(page):
    raw = page.get("/VP")
    if isinstance(raw, dict):
        items = [raw]
    elif isinstance(raw, list):
        items = [item for item in raw if isinstance(item, dict)]
    else:
        return []
    found = []
    for item in items:
        measure = item.get("/Measure")
        bbox = item.get("/BBox")
        if not isinstance(measure, dict) or not isinstance(bbox, list):
            continue
        if "/C" not in measure or "/U" not in measure:
            continue
        entry = {
            "bbox": [float(value) for value in bbox],
            "c": float(measure["/C"]),
            "unit": _pdf_text(measure["/U"]),
        }
        if "/R" in measure:
            entry["ratio"] = _pdf_text(measure["/R"])
        found.append(entry)
    return found


def _measures_by_page(data):
    objects = data["qpdf"][1]
    found = {}
    for index, page in enumerate(data.get("pages") or []):
        value = objects.get("obj:" + page.get("object", ""), {}).get("value")
        found[index] = _viewports(value) if isinstance(value, dict) else []
    return found


def report(path, png=None, dpi=100):
    info = {"path": path, "pages": [], "layers": []}
    try:
        data, damaged = _qpdf_json(path)
        info["damaged"] = damaged
        info["layers"] = _layers(data)
        measures = _measures_by_page(data)
    except Exception as error:  # pragma: no cover - alleen informatief
        info["damaged"] = False
        info["layers_error"] = str(error)
        measures = {}

    doc = meting.open_pdf(path)
    try:
        for number in range(len(doc)):
            page = doc[number]
            drawings, items = meting.path_summary(page)
            text = meting.page_text(page)
            width, height = meting.display_size(page)
            info["pages"].append(
                {
                    "page": number + 1,
                    "width_mm": round(width * 25.4 / 72, 2),
                    "height_mm": round(height * 25.4 / 72, 2),
                    "drawings": drawings,
                    "items": items,
                    "characters": len(text.strip()),
                    "text_sample": " | ".join(t for t in text.splitlines() if t.strip())[:160],
                    "measures": measures.get(number, []),
                }
            )
            if png and number == 0:
                pixels = max(1, round(width * dpi / 72))
                meting.render_rgb(page, pixels).save(png)
    finally:
        doc.close()
    return info


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    path = args[0]
    png = None
    dpi = 100
    if "--png" in args:
        png = args[args.index("--png") + 1]
    if "--dpi" in args:
        dpi = int(args[args.index("--dpi") + 1])
    info = report(path, png, dpi)
    if "--json" in args:
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0
    print(f"{path}: {len(info['pages'])} pagina's, {len(info['layers'])} lagen")
    for p in info["pages"]:
        print(
            f"  pagina {p['page']}: {p['width_mm']} × {p['height_mm']} mm, {p['drawings']} tekenobjecten, "
            f"{p['characters']} tekens, meetschaal {p['measures']}"
        )
    if info["layers"]:
        print("  lagen:", ", ".join(f"{l['text']}{'' if l['on'] else ' (uit)'}" for l in info["layers"][:12]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
