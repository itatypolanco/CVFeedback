import React, { useState } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import {
  CloudArrowUpIcon,
  CheckBadgeIcon,
  ArrowPathIcon,
  CreditCardIcon,
  KeyIcon,
} from '@heroicons/react/24/outline';

function App() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8001";
  const [file, setFile] = useState(null);
  const [previewFeedback, setPreviewFeedback] = useState("");
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [analysisId, setAnalysisId] = useState("");
  const [loading, setLoading] = useState(false);
  const [codigoAcceso, setCodigoAcceso] = useState("");
  const [validandoCodigo, setValidandoCodigo] = useState(false);
  const [estadoCodigo, setEstadoCodigo] = useState("");
  const [mensajeCodigo, setMensajeCodigo] = useState("");
  const whatsappNumber = import.meta.env.VITE_WHATSAPP_NUMBER || "593963339045";
  const fallbackPreviewMessage = "Tu CV fue analizado correctamente, pero la previsualizacion no llego en texto. Puedes continuar con el desbloqueo premium para obtener el reporte completo.";

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setPreviewFeedback("");
    setIsPreviewModalOpen(false);
    setAnalysisId("");
    setMensajeCodigo("");
    setEstadoCodigo("");
  };

  const handleUpload = async () => {
    if (!file) return alert("Por favor, selecciona un archivo primero.");

    setLoading(true);
    setPreviewLoading(true);
    setIsPreviewModalOpen(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      // Nota: Asegúrate de que tu FastAPI esté corriendo en el puerto 8000
      const response = await axios.post(`${apiBaseUrl}/analizar-cv`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const data = response?.data || {};
      const preview =
        data.preview_feedback ||
        data.preview ||
        data.feedback_preview ||
        data.feedback ||
        "";
      const nextAnalysisId = data.analysis_id || data.analysisId || "";

      setPreviewFeedback((preview || "").trim() || fallbackPreviewMessage);
      setAnalysisId(nextAnalysisId);
    } catch (error) {
      console.error("Error subiendo el archivo:", error);
      setPreviewFeedback("No se pudo generar la previsualizacion en este momento. Intenta nuevamente.");
      alert("Hubo un error al procesar tu CV. Revisa la consola.");
    } finally {
      setPreviewLoading(false);
      setLoading(false);
    }
  };

  const handleValidarCodigo = async () => {
    if (!codigoAcceso.trim()) {
      alert("Ingresa tu codigo de acceso.");
      return;
    }

    setValidandoCodigo(true);
    setEstadoCodigo("");
    setMensajeCodigo("");

    try {
      if (!analysisId) {
        await axios.post(`${apiBaseUrl}/desbloquear`, {
          codigo: codigoAcceso.trim(),
        });
        setEstadoCodigo("ok");
        setMensajeCodigo("Codigo valido. Ahora sube tu CV y ejecuta el analisis para descargar el feedback completo.");
        return;
      }

      const response = await axios.post(`${apiBaseUrl}/descargar-feedback`, {
        codigo: codigoAcceso.trim(),
        analysis_id: analysisId,
      }, {
        responseType: "blob",
      });

      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "feedback_experienciaia.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setEstadoCodigo("ok");
      setMensajeCodigo("Codigo valido. Descarga iniciada.");
    } catch (error) {
      setEstadoCodigo("error");
      if (error?.response?.data instanceof Blob) {
        const text = await error.response.data.text();
        try {
          const json = JSON.parse(text);
          setMensajeCodigo(json?.detail || "No se pudo validar el codigo.");
        } catch {
          setMensajeCodigo("No se pudo validar el codigo.");
        }
      } else {
        setMensajeCodigo(error?.response?.data?.detail || "No se pudo validar el codigo.");
      }
    } finally {
      setValidandoCodigo(false);
    }
  };

  const handleEnviarWhatsapp = () => {
    const texto = encodeURIComponent(
      "Hola, ya realice la transferencia para ExperienciaIA. Comparto mi comprobante y solicito mi codigo de acceso premium."
    );
    window.open(`https://wa.me/${whatsappNumber}?text=${texto}`, "_blank");
  };

  return (
    <div className="min-h-screen bg-experiencia-dark text-white font-sans">
      {isPreviewModalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-2xl bg-[#111827] border border-white/10 rounded-2xl p-6 md:p-8">
            <div className="flex items-start justify-between gap-4 mb-5">
              <h2 className="text-xl md:text-2xl font-bold">Tu previsualizacion gratuita</h2>
              <button
                onClick={() => setIsPreviewModalOpen(false)}
                className="text-gray-300 hover:text-white font-semibold"
                aria-label="Cerrar previsualizacion"
              >
                Cerrar
              </button>
            </div>

            {previewLoading ? (
              <div className="bg-white/5 p-5 rounded-xl border border-white/10 min-h-36 flex items-center justify-center gap-3 text-gray-200">
                <ArrowPathIcon className="w-5 h-5 animate-spin text-experiencia-yellow" />
                Analizando tu CV, un momento...
              </div>
            ) : (
              <div className="prose prose-invert max-w-none bg-white/5 p-5 rounded-xl border border-white/10 whitespace-pre-wrap max-h-[60vh] overflow-y-auto">
                <ReactMarkdown>{previewFeedback || fallbackPreviewMessage}</ReactMarkdown>
              </div>
            )}

            <p className="mt-4 text-sm text-gray-400">
              Esta es una vista rapida gratuita. Para descargar el informe completo, valida tu codigo premium.
            </p>
          </div>
        </div>
      )}
      <nav className="border-b border-white/10 py-4 px-8 flex justify-between items-center bg-experiencia-dark/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-experiencia-yellow rounded-lg flex items-center justify-center">
            <span className="text-black font-black">E</span>
          </div>
          <span className="text-xl font-bold tracking-tighter">Experiencia<span className="text-experiencia-yellow">IA</span></span>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto pt-16 px-6 pb-20">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-6xl font-black mb-4">Optimiza tu CV de <span className="text-experiencia-yellow">Datos.</span></h1>
          <p className="text-gray-400">
            En ExperienciaIA desarrollamos estrategias técnicas para que tu CV supere filtros ATS y <br />
            conecte con reclutadores. Reporte Full-Access vía transferencia. 
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white/5 border border-white/10 rounded-3xl p-8">
            {!previewFeedback ? (
              <div className="space-y-6 text-center">
                <h2 className="text-2xl font-bold">Analisis gratuito</h2>
                <div className="border-2 border-dashed border-white/20 rounded-2xl p-10 hover:border-experiencia-yellow/40 transition-colors relative">
                  <input
                    type="file"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={handleFileChange}
                    accept=".pdf"
                  />
                  <CloudArrowUpIcon className="w-12 h-12 text-experiencia-yellow mx-auto mb-4" />
                  <p className="font-medium text-lg">
                    {file ? file.name : "Selecciona tu CV (PDF)"}
                  </p>
                  <p className="text-sm text-gray-500 mt-2">Maximo 5MB</p>
                </div>

                <button
                  onClick={handleUpload}
                  disabled={loading || !file}
                  className={`w-full py-4 rounded-xl font-bold text-black transition-all flex items-center justify-center gap-2 ${
                    loading || !file ? 'bg-gray-600 cursor-not-allowed' : 'bg-experiencia-yellow hover:scale-[1.02] active:scale-[0.98]'
                  }`}
                >
                  {loading ? (
                    <>
                      <ArrowPathIcon className="w-5 h-5 animate-spin" />
                      Analizando Perfil...
                    </>
                  ) : (
                    "Iniciar Analisis Gratuito"
                  )}
                </button>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-experiencia-yellow/20 rounded-full flex items-center justify-center">
                    <CheckBadgeIcon className="w-6 h-6 text-experiencia-yellow" />
                  </div>
                  <h2 className="text-2xl font-bold">Mini previsualizacion gratuita</h2>
                </div>

                <div className="prose prose-invert max-w-none bg-white/5 p-6 rounded-2xl border border-white/10 whitespace-pre-wrap">
                  <ReactMarkdown>{previewFeedback}</ReactMarkdown>
                </div>
                <p className="mt-3 text-sm text-gray-400">
                  Este es un resumen corto. Para obtener el feedback completo de ExperienciaIA en PDF, usa tu codigo premium.
                </p>

                <button
                  onClick={() => {
                    setPreviewFeedback("");
                    setIsPreviewModalOpen(false);
                    setAnalysisId("");
                    setFile(null);
                  }}
                  className="mt-8 text-experiencia-yellow font-semibold hover:underline"
                >
                  Analizar otro documento
                </button>
              </div>
            )}
          </div>

          <div className="bg-white/5 border border-white/10 rounded-3xl p-8">
            <div className="flex items-center gap-2 mb-6">
              <CreditCardIcon className="w-5 h-5 text-experiencia-yellow" />
              <h2 className="text-2xl font-bold">Acceso premium por transferencia</h2>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-gray-300 leading-relaxed">
                1) Paso 1: Completa tu transferencia bancaria (Banco Pichincha).<br />
                2) Paso 2: Notifícanos por WhatsApp adjuntando tu comprobante de pago.<br />
                3) Paso 3: Una vez confirmado, te enviaremos un código alfanumérico personal con el que podrás acceder a las estrategias detalladas de ExperienciaIA y descargar tu informe final.<br />               
              </p>

              <button
                onClick={handleEnviarWhatsapp}
                className="w-full py-4 rounded-xl font-bold text-black transition-all flex items-center justify-center gap-2 bg-experiencia-yellow hover:scale-[1.02] active:scale-[0.98]"
              >
                Enviar comprobante por WhatsApp
              </button>

              <div className="border border-white/10 bg-black/20 rounded-2xl p-4 mt-2 space-y-3">
                <div className="flex items-center gap-2 text-gray-200 font-semibold">
                  <KeyIcon className="w-5 h-5 text-experiencia-yellow" />
                  Validar codigo alfanumerico
                </div>
                <input
                  type="text"
                  value={codigoAcceso}
                  onChange={(e) => setCodigoAcceso(e.target.value)}
                  placeholder="Ej: EXIA-A1B2C3D4"
                  className="w-full bg-black/30 border border-white/15 rounded-xl px-4 py-3 outline-none focus:border-experiencia-yellow uppercase"
                />
                <button
                  onClick={handleValidarCodigo}
                  disabled={validandoCodigo}
                  className={`w-full py-3 rounded-xl font-bold text-black transition-all ${
                    validandoCodigo ? "bg-gray-600 cursor-not-allowed" : "bg-experiencia-yellow hover:scale-[1.01] active:scale-[0.99]"
                  }`}
                >
                  {validandoCodigo ? "Procesando..." : "Desbloquear y descargar feedback completo"}
                </button>

                {mensajeCodigo && (
                  <div className={`rounded-xl px-4 py-3 text-sm ${
                    estadoCodigo === "ok"
                      ? "bg-emerald-500/10 border border-emerald-400/40 text-emerald-300"
                      : "bg-rose-500/10 border border-rose-400/40 text-rose-300"
                  }`}>
                    {mensajeCodigo}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center py-10 text-gray-600 text-xs tracking-widest uppercase">
        ExperienciaIA © 2026 • Quito, Ecuador
      </footer>
    </div>
  );
}

export default App;