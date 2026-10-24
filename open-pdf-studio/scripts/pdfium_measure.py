"""Page measurements through PDFium (pypdfium2).

Coordinates that leave this module as "display" points use a top-left origin
and y pointing down, after the page's /Rotate. Output millimetres for CAD
checks use a bottom-left origin and y pointing up, in that same displayed page.
"""

import ctypes
import math

import numpy as np
import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c

MM_PER_PT = 25.4 / 72.0


def open_pdf(path):
    return pdfium.PdfDocument(str(path))


def mediabox(page):
    return tuple(page.get_mediabox())


def rotation(page):
    return int(page.get_rotation()) % 360


def display_size(page):
    return page.get_size()


def pdf_to_display(x, y, page):
    """PDF user space (y up) to displayed points (y down)."""
    left, bottom, right, top = mediabox(page)
    xu = x - left
    yu = top - y
    w, h = right - left, top - bottom
    turn = rotation(page)
    if turn == 90:
        return h - yu, xu
    if turn == 180:
        return w - xu, h - yu
    if turn == 270:
        return yu, w - xu
    return xu, yu


def _display_direction(angle, turn):
    """Character angle from PDFium, then the page's /Rotate.

    ``FPDFText_GetCharAngle`` is radians on the unrotated page with y pointing
    down (0 is to the right). ``/Rotate`` turns that page clockwise.
    """
    dx, dy = math.cos(angle), math.sin(angle)
    if turn == 90:
        return -dy, dx
    if turn == 180:
        return -dx, -dy
    if turn == 270:
        return dy, -dx
    return dx, dy


def to_output_mm(x_pdf, y_pdf, page, scale):
    """Displayed page, y up, in millimetres. `scale` is the export denominator."""
    xd, yd = pdf_to_display(x_pdf, y_pdf, page)
    _, height = display_size(page)
    k = MM_PER_PT * scale
    return (xd * k, (height - yd) * k)


def _page_point(obj, x, y):
    """Path-local point, through this object and any parent form, in PDF space."""
    px, py = obj.get_matrix().on_point(x, y)
    container = getattr(obj, "container", None)
    while container is not None:
        px, py = container.get_matrix().on_point(px, py)
        container = getattr(container, "container", None)
    return px, py


def _bitmap_image(bitmap, mode):
    try:
        image = bitmap.to_pil().convert(mode)
        return image.copy()
    finally:
        bitmap.close()


def render_rgb(page, width):
    page_width, _ = display_size(page)
    if page_width <= 0:
        raise ValueError(f"page has no width: {page_width}")
    scale = width / page_width
    bitmap = page.render(scale=scale, fill_color=(255, 255, 255, 255), may_draw_forms=False)
    return _bitmap_image(bitmap, "RGB")


def render_gray(page, dpi):
    scale = dpi / 72.0
    bitmap = page.render(
        scale=scale,
        grayscale=True,
        fill_color=(255, 255, 255, 255),
        may_draw_forms=False,
    )
    image = _bitmap_image(bitmap, "L")
    return np.array(image)


def dark_bounds_mm(page, dpi=600):
    """Bounding box of pixels darker than mid-grey, in mm from the top left."""
    image = render_gray(page, dpi)
    rows = np.where((image < 128).any(axis=1))[0]
    cols = np.where((image < 128).any(axis=0))[0]
    if len(rows) == 0:
        return None
    px = 25.4 / dpi
    x0, x1 = int(cols[0]), int(cols[-1]) + 1
    y0, y1 = int(rows[0]), int(rows[-1]) + 1
    return (x0 * px, y0 * px, (x1 - x0) * px, (y1 - y0) * px)


def _image_display_rect(obj, page):
    left, bottom, right, top = obj.get_bounds()
    corners = [pdf_to_display(x, y, page) for x, y in ((left, bottom), (right, bottom), (right, top), (left, top))]
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    return min(xs), min(ys), max(xs), max(ys)


def image_union_mm(page):
    """Union of image bounds in mm from the top left, and how many images."""
    width, height = display_size(page)
    rects = []
    for obj in page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_IMAGE]):
        x0, y0, x1, y1 = _image_display_rect(obj, page)
        x0, y0 = max(0.0, x0), max(0.0, y0)
        x1, y1 = min(width, x1), min(height, y1)
        if x1 > x0 and y1 > y0:
            rects.append((x0, y0, x1, y1))
    if not rects:
        return None
    x0 = min(r[0] for r in rects)
    y0 = min(r[1] for r in rects)
    x1 = max(r[2] for r in rects)
    y1 = max(r[3] for r in rects)
    box = (x0 * MM_PER_PT, y0 * MM_PER_PT, (x1 - x0) * MM_PER_PT, (y1 - y0) * MM_PER_PT)
    return box, len(rects)


def image_coverage(page):
    """Largest image area divided by the displayed page area, and the count."""
    width, height = display_size(page)
    area = width * height
    largest = 0.0
    count = 0
    for obj in page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_IMAGE]):
        x0, y0, x1, y1 = _image_display_rect(obj, page)
        largest = max(largest, max(0.0, x1 - x0) * max(0.0, y1 - y0))
        count += 1
    if area <= 0:
        return 0.0, count
    return largest / area, count


def page_text(page):
    textpage = page.get_textpage()
    try:
        text = textpage.get_text_range() or ""
        return text.replace("\r\n", "\n").replace("\r", "\n")
    finally:
        textpage.close()


def _real_char(textpage, index):
    """PDFium inserts line breaks. Those are not characters from the file."""
    return not pdfium_c.FPDFText_IsGenerated(textpage.raw, index)


def text_directions(page):
    """Writing directions of the characters, in displayed y-down space."""
    textpage = page.get_textpage()
    turn = rotation(page)
    found = set()
    try:
        for index in range(textpage.count_chars()):
            if not _real_char(textpage, index):
                continue
            angle = pdfium_c.FPDFText_GetCharAngle(textpage.raw, index)
            dx, dy = _display_direction(angle, turn)
            length = math.hypot(dx, dy) or 1.0
            found.add((round(dx / length, 3) + 0.0, round(dy / length, 3) + 0.0))
    finally:
        textpage.close()
    return found


def annot_count(page):
    return int(pdfium_c.FPDFPage_GetAnnotCount(page.raw))


def _path_points(obj):
    count = int(pdfium_c.FPDFPath_CountSegments(obj.raw))
    points = []
    for index in range(count):
        segment = pdfium_c.FPDFPath_GetPathSegment(obj.raw, index)
        if not segment:
            continue
        x = ctypes.c_float()
        y = ctypes.c_float()
        if not pdfium_c.FPDFPathSegment_GetPoint(segment, ctypes.byref(x), ctypes.byref(y)):
            continue
        px, py = _page_point(obj, x.value, y.value)
        points.append((
            int(pdfium_c.FPDFPathSegment_GetType(segment)),
            px,
            py,
            bool(pdfium_c.FPDFPathSegment_GetClose(segment)),
        ))
    return points


def _draw_mode(obj):
    fill = ctypes.c_int()
    stroke = ctypes.c_int()
    pdfium_c.FPDFPath_GetDrawMode(obj.raw, ctypes.byref(fill), ctypes.byref(stroke))
    return bool(fill.value), bool(stroke.value)


def _segment_kinds(points):
    """One entry per line or cubic. A cubic is three Bézier points."""
    kinds = []
    index = 0
    while index < len(points):
        kind = points[index][0]
        if kind == pdfium_c.FPDF_SEGMENT_BEZIERTO and index + 2 < len(points):
            kinds.append("c")
            index += 3
        elif kind == pdfium_c.FPDF_SEGMENT_LINETO:
            kinds.append("l")
            index += 1
        else:
            index += 1
    return kinds


def path_summary(page):
    """How many paths, and how many line and curve commands they contain."""
    paths = 0
    items = {}
    for obj in page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_PATH]):
        paths += 1
        for name in _segment_kinds(_path_points(obj)):
            items[name] = items.get(name, 0) + 1
    return paths, items


def path_geometry(page, scale, skip_page_fills=True):
    """Endpoints and segments in output millimetres, matching the DXF export."""
    endpoints, segments = [], []
    counts = {"paths": 0, "stroked": 0, "filled": 0, "items": 0, "zero_length": 0, "page_fills": 0}
    page_w, page_h = display_size(page)
    for obj in page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_PATH]):
        filled, stroked = _draw_mode(obj)
        if not filled and not stroked:
            continue
        if skip_page_fills and filled and not stroked:
            x0, y0, x1, y1 = _image_display_rect(obj, page)
            if (x1 - x0) >= 0.95 * page_w and (y1 - y0) >= 0.95 * page_h:
                counts["page_fills"] += 1
                continue
        counts["paths"] += 1
        counts["stroked"] += int(stroked)
        counts["filled"] += int(filled)
        local = _path_points(obj)
        current = None
        start = None
        index = 0
        while index < len(local):
            kind, x, y, close = local[index]
            counts["items"] += 1
            if kind == pdfium_c.FPDF_SEGMENT_MOVETO:
                current = start = (x, y)
                index += 1
            elif kind == pdfium_c.FPDF_SEGMENT_LINETO:
                end = (x, y)
                _add_line(endpoints, segments, counts, page, scale, current, end)
                current = end
                index += 1
            elif kind == pdfium_c.FPDF_SEGMENT_BEZIERTO and index + 2 < len(local):
                _, x1, y1, _ = local[index]
                _, x2, y2, _ = local[index + 1]
                _, x3, y3, close = local[index + 2]
                _add_curve(endpoints, segments, page, scale, current, (x1, y1), (x2, y2), (x3, y3))
                current = (x3, y3)
                index += 3
            else:
                index += 1
            if close and start is not None and current is not None and current != start:
                _add_line(endpoints, segments, counts, page, scale, current, start)
                current = start
    return endpoints, segments, counts


def _add_line(endpoints, segments, counts, page, scale, start, end):
    if start is None:
        return
    a = to_output_mm(start[0], start[1], page, scale)
    b = to_output_mm(end[0], end[1], page, scale)
    if a == b:
        counts["zero_length"] += 1
        return
    endpoints.extend((a, b))
    segments.append((a, b))


def _add_curve(endpoints, segments, page, scale, start, c1, c2, end):
    if start is None:
        return
    points = [to_output_mm(*p, page, scale) for p in (start, c1, c2, end)]
    endpoints.extend((points[0], points[3]))
    previous = points[0]
    for step in range(1, 65):
        t = step / 64.0
        mt = 1 - t
        x = mt**3 * points[0][0] + 3 * mt * mt * t * points[1][0] + 3 * mt * t * t * points[2][0] + t**3 * points[3][0]
        y = mt**3 * points[0][1] + 3 * mt * mt * t * points[1][1] + 3 * mt * t * t * points[2][1] + t**3 * points[3][1]
        segments.append((previous, (x, y)))
        previous = (x, y)


def text_chars(page, scale):
    """Each character as (position mm, character, size mm, angle degrees)."""
    textpage = page.get_textpage()
    turn = rotation(page)
    chars = []
    try:
        for index in range(textpage.count_chars()):
            if not _real_char(textpage, index):
                continue
            origin_x = ctypes.c_double()
            origin_y = ctypes.c_double()
            pdfium_c.FPDFText_GetCharOrigin(
                textpage.raw, index, ctypes.byref(origin_x), ctypes.byref(origin_y),
            )
            angle = pdfium_c.FPDFText_GetCharAngle(textpage.raw, index)
            dx, dy = _display_direction(angle, turn)
            degrees = math.degrees(math.atan2(-dy, dx)) % 360
            size = pdfium_c.FPDFText_GetFontSize(textpage.raw, index) * MM_PER_PT * scale
            chars.append((
                to_output_mm(origin_x.value, origin_y.value, page, scale),
                textpage.get_text_range(index, 1),
                size,
                degrees,
            ))
    finally:
        textpage.close()
    return chars
