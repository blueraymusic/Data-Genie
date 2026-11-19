"""Plain-text report exports; optional PDF libraries never affect core SQLite use."""
from datetime import datetime, timezone
from functools import lru_cache
from html import escape
from io import BytesIO
from pathlib import Path
import re
import threading
import unicodedata


_FONT_LOCK = threading.Lock()
_FONT_DIRECTORY = Path(__file__).resolve().parent / 'assets' / 'fonts'


class PdfExportUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _fonts():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    with _FONT_LOCK:
        for name, filename in (('GenieSans', 'NotoSans-Regular.ttf'),
                               ('GenieSansBold', 'NotoSans-Bold.ttf'),
                               ('GenieSymbols', 'NotoSansSymbols2-Regular.ttf'),
                               ('GenieCJK', 'NotoSansCJK-Regular.ttf')):
            if name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(name, str(_FONT_DIRECTORY / filename)))
    return {name: pdfmetrics.getFont(name).face.charToGlyph
            for name in ('GenieSans', 'GenieSansBold', 'GenieSymbols', 'GenieCJK')}


def _font_for(character, fonts, bold=False):
    point = ord(character)
    regular = 'GenieSansBold' if bold else 'GenieSans'
    if point in fonts[regular]:
        return regular
    if point in fonts['GenieSymbols']:
        return 'GenieSymbols'
    if point in fonts['GenieCJK']:
        return 'GenieCJK'
    raise ValueError(f'PDF export cannot render a character in this report (U+{point:04X}). '
                     'The saved report is unchanged. Copy the text or save a version without that character.')


def _paragraph_text(text, fonts, bold=False):
    """Only our fixed font tags are markup; all report text is escaped."""
    runs, characters, current = [], [], None
    for character in text.expandtabs(4):
        name = _font_for(character, fonts, bold)
        if name != current and characters:
            runs.append(f'<font name="{current}">{escape("".join(characters))}</font>')
            characters = []
        current = name
        characters.append(character)
    if characters:
        runs.append(f'<font name="{current}">{escape("".join(characters))}</font>')
    return ''.join(runs)


def filename(title):
    normalized = unicodedata.normalize('NFKD', title).encode('ascii', 'ignore').decode()
    name = re.sub(r'[^A-Za-z0-9._-]+', '-', normalized).strip('.-')[:80] or 'report'
    return name + '.pdf'


def render_report(report):
    """Render a saved, already-authorized report without HTML, files, or network IO."""
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.pdfbase.ttfonts import TTFError
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    except ImportError:
        raise PdfExportUnavailable('PDF export is unavailable on this server. You can still read the saved report.') from None
    try:
        fonts = _fonts()
    except (OSError, TTFError):
        raise PdfExportUnavailable('PDF export is unavailable on this server. You can still read the saved report.') from None

    title, body = report['title'], report['body']
    author = ' '.join(value for value in (report.get('first_name'), report.get('last_name')) if value)
    status = 'Shared report' if report['published'] else 'Private draft'
    updated = datetime.fromtimestamp(report['updated_at'], timezone.utc).strftime('%d %b %Y, %H:%M UTC')
    metadata = f'{status} | {author} | Updated {updated}'
    output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, rightMargin=54, leftMargin=54,
                                 topMargin=64, bottomMargin=58, title=title, author=author,
                                 subject='Data Genie report', pageCompression=1)
    ink, muted, lapis = colors.HexColor('#16213a'), colors.HexColor('#586782'), colors.HexColor('#2d4ea2')
    title_style = ParagraphStyle('ReportTitle', fontName='GenieSansBold', fontSize=23,
                                 leading=30, textColor=ink, spaceAfter=12, splitLongWords=True)
    meta_style = ParagraphStyle('ReportMetadata', fontName='GenieSans', fontSize=8.5,
                                leading=13, textColor=muted, spaceAfter=22, splitLongWords=True)
    body_style = ParagraphStyle('ReportBody', fontName='GenieSans', fontSize=10.5,
                                leading=16.5, textColor=ink, spaceAfter=3, splitLongWords=True)
    story = [Paragraph(_paragraph_text(title, fonts, bold=True), title_style),
             Paragraph(_paragraph_text(metadata, fonts), meta_style)]
    for line in body.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        story.append(Paragraph(_paragraph_text(line, fonts), body_style) if line.strip() else Spacer(1, 11))

    def page_chrome(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(lapis)
        canvas.setFont('GenieSansBold', 9)
        canvas.drawString(doc.leftMargin, A4[1] - 35, 'DATA GENIE')
        canvas.setStrokeColor(colors.HexColor('#d9dfea'))
        canvas.line(doc.leftMargin, 42, A4[0] - doc.rightMargin, 42)
        canvas.setFillColor(muted)
        canvas.setFont('GenieSans', 8)
        canvas.drawString(doc.leftMargin, 28, 'Report snapshot')
        canvas.drawRightString(A4[0] - doc.rightMargin, 28, str(doc.page))
        canvas.restoreState()

    document.build(story, onFirstPage=page_chrome, onLaterPages=page_chrome)
    return output.getvalue()
