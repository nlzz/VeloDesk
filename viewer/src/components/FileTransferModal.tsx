import React, { useState } from 'react';
import { UploadCloud, CheckCircle2, ShieldCheck, X, File } from 'lucide-react';

interface FileTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendFile: (file: File, sha256: string) => Promise<void>;
}

export const FileTransferModal: React.FC<FileTransferModalProps> = ({
  isOpen,
  onClose,
  onSendFile,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [hash, setHash] = useState<string>('');
  const [isHashing, setIsHashing] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [transferComplete, setTransferComplete] = useState(false);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setIsHashing(true);
    setTransferComplete(false);
    setProgress(0);

    try {
      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const hashHex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      setHash(hashHex);
    } catch (err) {
      console.error('[FileTransfer] Erro ao calcular SHA-256:', err);
    } finally {
      setIsHashing(false);
    }
  };

  const handleStartTransfer = async () => {
    if (!selectedFile || !hash) return;
    setIsTransferring(true);
    setProgress(20);

    try {
      // Simula progresso fluido com envio real
      setTimeout(() => setProgress(60), 300);
      await onSendFile(selectedFile, hash);
      setProgress(100);
      setTransferComplete(true);
    } catch (err) {
      console.error('[FileTransfer] Erro na transferência:', err);
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-blue-400" />
            <h3 className="font-bold text-sm text-slate-100">Transferência de Arquivos Segura</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informações de Salvaguarda LGPD & AMSI */}
        <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-3 flex items-start gap-2.5 text-xs text-blue-300">
          <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-400" />
          <div>
            Arquivos transferidos são gravados na <strong>pasta de quarentena</strong> do host, validados por SHA-256 e inspecionados pelo <strong>Windows AMSI</strong> antes da liberação.
          </div>
        </div>

        {/* Seletor de Arquivo */}
        {!selectedFile ? (
          <label className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition bg-slate-800/30">
            <UploadCloud className="w-8 h-8 text-slate-400 mb-2" />
            <span className="text-xs font-semibold text-slate-200">Clique para selecionar arquivo</span>
            <span className="text-[11px] text-slate-500 mt-1">Fragmentação em blocos de 64 KB</span>
            <input type="file" onChange={handleFileChange} className="hidden" />
          </label>
        ) : (
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <File className="w-5 h-5 text-blue-400 flex-shrink-0" />
              <div className="truncate flex-1">
                <div className="text-xs font-semibold text-slate-100 truncate">{selectedFile.name}</div>
                <div className="text-[10px] text-slate-400 font-mono">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </div>
              </div>
            </div>

            {/* Hash Forense */}
            <div className="text-[10px] font-mono text-slate-400 bg-slate-900 p-2 rounded border border-slate-800">
              <span className="text-blue-400 font-bold">SHA-256: </span>
              {isHashing ? 'Calculando hash...' : hash}
            </div>
          </div>
        )}

        {/* Barra de Progresso */}
        {isTransferring && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Transferindo...</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-blue-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {transferComplete && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <span>Arquivo enviado e verificado com sucesso pelo host!</span>
          </div>
        )}

        {/* Ações */}
        <div className="flex gap-2 justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
          >
            Fechar
          </button>
          <button
            type="button"
            disabled={!selectedFile || isHashing || isTransferring || transferComplete}
            onClick={handleStartTransfer}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-bold text-white shadow"
          >
            Enviar Arquivo
          </button>
        </div>
      </div>
    </div>
  );
};
