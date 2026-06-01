import os
import uuid
from io import BytesIO
import unicodedata
from urllib.parse import urlparse, parse_qs
import textwrap

import fitz  # PyMuPDF
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import OpenAI
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

# 1. Cargar configuración
load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")

if not api_key:
    print("❌ ADVERTENCIA: No se encontró OPENAI_API_KEY en el entorno.")

# 2. Inicializar servicios
app = FastAPI()
client = OpenAI(api_key=api_key)

# 3. Middleware CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SHEET_URL = os.getenv("GOOGLE_SHEET_CSV_URL", "")
ANALYSIS_CACHE = {}
ACCESS_USAGE_DELTAS = {}


def _build_preview(text: str, max_chars: int = 450) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "\n\n...Desbloquea con tu codigo para ver el feedback completo."


def _normalize_key(value: str) -> str:
    text = str(value or "").strip().lower()
    text = "".join(
        ch for ch in unicodedata.normalize("NFD", text)
        if unicodedata.category(ch) != "Mn"
    )
    return text.replace(" ", "").replace("_", "")


def _resolve_column(columns, *aliases):
    normalized_columns = {_normalize_key(col): col for col in columns}
    for alias in aliases:
        col = normalized_columns.get(_normalize_key(alias))
        if col:
            return col
    raise HTTPException(
        status_code=500,
        detail=f"No se encontro la columna requerida ({', '.join(aliases)}) en Google Sheets",
    )


def _is_active(value) -> bool:
    normalized = _normalize_key(value)
    return normalized in {"true", "activo", "activa", "1", "si", "yes"}


def _build_sheet_csv_url(raw_url: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        return ""
    if "output=csv" in url or "/export?" in url:
        return url

    parsed = urlparse(url)
    if "docs.google.com" not in parsed.netloc:
        return url

    parts = [p for p in parsed.path.split("/") if p]
    spreadsheet_id = ""
    if "d" in parts:
        d_idx = parts.index("d")
        if d_idx + 1 < len(parts):
            spreadsheet_id = parts[d_idx + 1]
    if not spreadsheet_id:
        return url

    query = parse_qs(parsed.query)
    gid = query.get("gid", ["0"])[0]
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=csv&gid={gid}"


def _validate_access_code(codigo_usuario: str, consume: bool = False) -> str:
    if not codigo_usuario:
        raise HTTPException(status_code=400, detail="Debes ingresar un codigo")
    if not SHEET_URL:
        raise HTTPException(status_code=500, detail="No se configuro GOOGLE_SHEET_CSV_URL")

    sheet_csv_url = _build_sheet_csv_url(SHEET_URL)
    try:
        df = pd.read_csv(sheet_csv_url)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"No se pudo leer Google Sheets. Verifica URL publica CSV: {e}",
        )
    code_col = _resolve_column(df.columns, "Codigo", "Código")
    usos_max_col = _resolve_column(df.columns, "Usos Maximos", "Usos Máximos")
    usos_actuales_col = _resolve_column(df.columns, "Usos Actuales")
    estado_col = _resolve_column(df.columns, "Estado")

    codigo_normalizado = codigo_usuario.upper().strip()
    df[code_col] = df[code_col].astype(str).str.upper().str.strip()
    fila = df[df[code_col] == codigo_normalizado]

    if fila.empty:
        raise HTTPException(status_code=404, detail="Codigo no encontrado")

    indice = fila.index[0]
    usos_max = int(pd.to_numeric(df.at[indice, usos_max_col], errors="coerce") or 0)
    usos_actuales_sheet = int(pd.to_numeric(df.at[indice, usos_actuales_col], errors="coerce") or 0)
    activo = _is_active(df.at[indice, estado_col])
    usos_actuales_local = ACCESS_USAGE_DELTAS.get(codigo_normalizado, 0)
    usos_actuales_totales = usos_actuales_sheet + usos_actuales_local

    if not activo:
        raise HTTPException(status_code=403, detail="Codigo inactivo")
    if usos_actuales_totales >= usos_max:
        raise HTTPException(
            status_code=403,
            detail=f"Codigo agotado: {usos_actuales_totales}/{usos_max} usos consumidos",
        )

    if consume:
        ACCESS_USAGE_DELTAS[codigo_normalizado] = usos_actuales_local + 1

    return codigo_normalizado


def _wrap_text_for_pdf(c: canvas.Canvas, text: str, max_width: float, font_name: str, font_size: int):
    c.setFont(font_name, font_size)
    wrapped_lines = []
    for raw_paragraph in text.splitlines():
        paragraph = raw_paragraph.strip()
        if not paragraph:
            wrapped_lines.append("")
            continue

        words = paragraph.split()
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if c.stringWidth(candidate, font_name, font_size) <= max_width:
                current = candidate
            else:
                if current:
                    wrapped_lines.append(current)
                # Fallback for extra-long single words
                if c.stringWidth(word, font_name, font_size) > max_width:
                    chunks = textwrap.wrap(word, width=18)
                    wrapped_lines.extend(chunks[:-1])
                    current = chunks[-1]
                else:
                    current = word
        if current:
            wrapped_lines.append(current)
    return wrapped_lines


def _draw_pdf_header(c: canvas.Canvas, width: float, height: float, logo_path: str | None) -> float:
    top_y = height - 50
    if logo_path and os.path.exists(logo_path):
        try:
            logo = ImageReader(logo_path)
            img_w, img_h = logo.getSize()
            ratio = img_h / img_w if img_w else 1
            logo_w = 120
            logo_h = logo_w * ratio
            x = (width - logo_w) / 2
            c.drawImage(logo, x, top_y - logo_h, width=logo_w, height=logo_h, preserveAspectRatio=True, mask="auto")
            top_y = top_y - logo_h - 18
        except Exception:
            # Si hay error con el logo, seguimos con el PDF sin romper la descarga.
            pass

    c.setFont("Helvetica-Bold", 22)
    c.drawCentredString(width / 2, top_y, "ExperienciaIA")
    c.setFont("Helvetica", 12)
    c.setFillColor(colors.HexColor("#4B5563"))
    c.drawCentredString(width / 2, top_y - 20, "Reporte completo de feedback CV")
    c.setFillColor(colors.black)
    c.setStrokeColor(colors.HexColor("#E5E7EB"))
    c.setLineWidth(1)
    c.line(50, top_y - 32, width - 50, top_y - 32)
    return top_y - 52


def _build_feedback_pdf(feedback: str) -> BytesIO:
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter

    logo_path = os.path.join(os.path.dirname(__file__), "logo.png")
    y = _draw_pdf_header(c, width, height, logo_path)

    left_margin = 50
    right_margin = 50
    max_width = width - left_margin - right_margin
    line_height = 18
    lines = _wrap_text_for_pdf(c, feedback, max_width, "Helvetica", 12)

    c.setFont("Helvetica", 12)
    for line in lines:
        if y < 70:
            c.showPage()
            y = _draw_pdf_header(c, width, height, logo_path)
            c.setFont("Helvetica", 12)
        c.drawString(left_margin, y, line if line else " ")
        y -= line_height

    c.save()
    buffer.seek(0)
    return buffer

@app.post("/analizar-cv")
async def analizar_cv(file: UploadFile = File(...)):
    
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Solo se permiten PDFs")
    
    try:
        # Leer PDF
        contents = await file.read()
        doc = fitz.open(stream=contents, filetype="pdf")
        texto = ""
        for page in doc:
            texto += page.get_text()
            
        # Llamar a OpenAI (GPT-4o-mini)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Eres un experto reclutador tech."},
                {"role": "user", "content": f"Analiza este CV y da 3 tips: {texto}"}
            ]
        )
        
        feedback_completo = response.choices[0].message.content
        analysis_id = str(uuid.uuid4())
        ANALYSIS_CACHE[analysis_id] = feedback_completo

        return {
            "analysis_id": analysis_id,
            "preview_feedback": _build_preview(feedback_completo),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/desbloquear")
async def desbloquear_reporte(payload: dict):
    codigo_usuario = payload.get("codigo")
    
    try:
        _validate_access_code(codigo_usuario)
        return {"status": "success", "message": "Acceso concedido"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error al leer la base de datos: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno del servidor: {e}")


@app.post("/descargar-feedback")
async def descargar_feedback(payload: dict):
    codigo_usuario = payload.get("codigo")
    analysis_id = payload.get("analysis_id")

    if not analysis_id:
        raise HTTPException(status_code=400, detail="Falta analysis_id")

    feedback = ANALYSIS_CACHE.get(analysis_id)
    if not feedback:
        raise HTTPException(
            status_code=404,
            detail="No se encontro el analisis. Vuelve a subir tu CV para generar uno nuevo.",
        )

    _validate_access_code(codigo_usuario, consume=False)
    pdf_buffer = _build_feedback_pdf(feedback)
    _validate_access_code(codigo_usuario, consume=True)
    filename = f"experienciaia_feedback_{analysis_id[:8]}.pdf"

    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# cd /c/Users/salom/ExperienciaIACopia/backend
# ./.venv/Scripts/python.exe -m uvicorn main:app --reload --port 8001 --app-dir "/c/Users/salom/ExperienciaIACopia/backend"


# Para correrlo: uvicorn main:app --reload