"""Generate a local-network speaker URL QR using the bundled ReportLab runtime."""
import sys
from reportlab.graphics.shapes import Drawing, Rect
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics import renderSVG
from reportlab.lib.colors import white
drawing = Drawing(256, 256)
drawing.add(Rect(0, 0, 256, 256, fillColor=white, strokeColor=None))
drawing.add(QrCodeWidget(sys.argv[1], x=8, y=8, barWidth=240, barHeight=240, barBorder=4, barLevel='M'))
sys.stdout.write(renderSVG.drawToString(drawing))
