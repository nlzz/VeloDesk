import React, { useState } from 'react';
import {
  FolderPlus,
  Tag as TagIcon,
  Download,
  Copy,
  Check,
  Terminal,
  Monitor,
} from 'lucide-react';
import { api, TenantInfo, DeviceGroup } from '../../services/api';

const PRESET_TAG_COLORS = ['#10B981', '#3B82F6', '#EF4444', '#F59E0B', '#8B5CF6', '#06B6D4'];

const GROUP_SUGGESTIONS = ['Contabilidade', 'Fiscal', 'Departamento Pessoal', 'Servidores', 'Recepção', 'Diretoria'];
const TAG_SUGGESTIONS = ['VIP', 'Crítico', 'Recepção', 'Servidor', 'Prioritário', 'Home Office'];

interface DeviceActionModalsProps {
  tenant?: TenantInfo | null;
  groups: DeviceGroup[];
  isNewGroupOpen: boolean;
  onCloseNewGroup: () => void;
  onGroupCreated: () => void;
  isNewTagOpen: boolean;
  onCloseNewTag: () => void;
  onTagCreated: () => void;
  isInstallerOpen: boolean;
  onCloseInstaller: () => void;
}

export const DeviceActionModals: React.FC<DeviceActionModalsProps> = ({
  tenant,
  groups,
  isNewGroupOpen,
  onCloseNewGroup,
  onGroupCreated,
  isNewTagOpen,
  onCloseNewTag,
  onTagCreated,
  isInstallerOpen,
  onCloseInstaller,
}) => {
  // Estado: Novo Grupo
  const [groupName, setGroupName] = useState('');
  const [groupParentId, setGroupParentId] = useState('');
  const [isSubmittingGroup, setIsSubmittingGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  // Estado: Nova Tag
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState('#10B981');
  const [isSubmittingTag, setIsSubmittingTag] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);

  // Estado: Instalador
  const [copiedCmd, setCopiedCmd] = useState(false);

  const tenantSlug = tenant?.slug || 'simcontabil';
  const tenantName = tenant?.name || 'Escritório';
  const installCmd = `irm https://velodesk.stayai.space/install.ps1 | iex -Tenant "${tenantSlug}"`;

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    setIsSubmittingGroup(true);
    setGroupError(null);
    try {
      await api.createGroup(groupName.trim(), groupParentId ? groupParentId : undefined);
      setGroupName('');
      setGroupParentId('');
      onGroupCreated();
      onCloseNewGroup();
    } catch (err: any) {
      setGroupError(err.message || 'Erro ao criar grupo.');
    } finally {
      setIsSubmittingGroup(false);
    }
  };

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagName.trim()) return;

    setIsSubmittingTag(true);
    setTagError(null);
    try {
      await api.createTag(tagName.trim(), tagColor);
      setTagName('');
      setTagColor('#10B981');
      onTagCreated();
      onCloseNewTag();
    } catch (err: any) {
      setTagError(err.message || 'Erro ao criar tag.');
    } finally {
      setIsSubmittingTag(false);
    }
  };

  const handleCopyCmd = () => {
    navigator.clipboard.writeText(installCmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2500);
  };

  const handleDownloadInstaller = () => {
    const downloadUrl = `/download/velodesk-agent-setup.exe?tenant=${tenantSlug}`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', `VeloDesk-Agent-${tenantSlug}.exe`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      {/* ========================================================================= */}
      {/* MODAL 1: NOVO GRUPO DE DISPOSITIVOS */}
      {/* ========================================================================= */}
      {isNewGroupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-blue-400" />
                Criar Novo Grupo
              </h2>
              <button
                type="button"
                onClick={onCloseNewGroup}
                className="text-slate-500 hover:text-slate-300 text-sm"
              >
                ✕
              </button>
            </div>

            {groupError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                {groupError}
              </div>
            )}

            <form onSubmit={handleCreateGroup} autoComplete="off" className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Nome do Grupo *</label>
                <input
                  type="text"
                  required
                  id="device-group-name"
                  name="velodesk_device_group_name"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="ex: Contabilidade, Fiscal, Servidores..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Sugestões Rápidas */}
              <div>
                <span className="block text-[11px] text-slate-400 mb-1.5 font-medium">Sugestões rápidas:</span>
                <div className="flex flex-wrap gap-1.5">
                  {GROUP_SUGGESTIONS.map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => setGroupName(sug)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700/60 transition"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Grupo Pai (Opcional)</label>
                <select
                  id="device-group-parent"
                  name="velodesk_device_group_parent"
                  value={groupParentId}
                  onChange={(e) => setGroupParentId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
                >
                  <option value="">Nenhum (Grupo Raiz)</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={onCloseNewGroup}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingGroup}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {isSubmittingGroup ? 'Criando...' : 'Salvar Grupo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: NOVA TAG / ETIQUETA COLORIDA */}
      {/* ========================================================================= */}
      {isNewTagOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <TagIcon className="w-4 h-4 text-emerald-400" />
                Criar Nova Etiqueta (Tag)
              </h2>
              <button
                type="button"
                onClick={onCloseNewTag}
                className="text-slate-500 hover:text-slate-300 text-sm"
              >
                ✕
              </button>
            </div>

            {tagError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                {tagError}
              </div>
            )}

            <form onSubmit={handleCreateTag} autoComplete="off" className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Nome da Etiqueta *</label>
                <input
                  type="text"
                  required
                  id="device-tag-name"
                  name="velodesk_device_tag_name"
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                  placeholder="ex: VIP, Crítico, Recepção..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Sugestões Rápidas */}
              <div>
                <span className="block text-[11px] text-slate-400 mb-1.5 font-medium">Sugestões rápidas:</span>
                <div className="flex flex-wrap gap-1.5">
                  {TAG_SUGGESTIONS.map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => setTagName(sug)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700/60 transition"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </div>

              {/* Seleção de Cor */}
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Cor da Etiqueta (HEX)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    id="device-tag-color"
                    name="velodesk_device_tag_color"
                    value={tagColor}
                    onChange={(e) => setTagColor(e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border border-slate-700 p-0.5"
                  />
                  <div className="flex items-center gap-2 flex-1">
                    {PRESET_TAG_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setTagColor(c)}
                        style={{ backgroundColor: c }}
                        className={`w-6 h-6 rounded-full transition transform hover:scale-110 ${
                          tagColor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Pré-visualização da Tag */}
              {tagName && (
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-medium">Prévia:</span>
                  <span
                    className="text-xs font-semibold px-2.5 py-0.5 rounded-full border shadow-sm"
                    style={{
                      backgroundColor: `${tagColor}25`,
                      borderColor: tagColor,
                      color: tagColor,
                    }}
                  >
                    {tagName}
                  </span>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={onCloseNewTag}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingTag}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {isSubmittingTag ? 'Criando...' : 'Salvar Etiqueta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: BAIXAR INSTALADOR / CONECTAR MÁQUINA */}
      {/* ========================================================================= */}
      {isInstallerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
                  <Download className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-100">
                    Conectar Computador ao Escritório
                  </h2>
                  <span className="text-[11px] text-blue-400 font-mono">
                    {tenantName} • /t/{tenantSlug}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={onCloseInstaller}
                className="text-slate-500 hover:text-slate-300 text-sm"
              >
                ✕
              </button>
            </div>

            {/* Opção 1: Download Direto do Executável */}
            <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-950/40 via-indigo-950/20 to-slate-900 border border-blue-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Monitor className="w-3.5 h-3.5 text-blue-400" />
                  Opção 1: Download do Instalador Windows (.exe)
                </span>
                <span className="text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-bold">
                  Recomendado
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Executável pré-vinculado ao escritório <strong className="text-white font-mono">{tenantSlug}</strong>. Pronto para rodar em segundo plano como Serviço do Windows.
              </p>
              <button
                type="button"
                onClick={handleDownloadInstaller}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white shadow-md shadow-indigo-500/25 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>📥 Baixar VeloDesk Agent Setup (.exe)</span>
              </button>
            </div>

            {/* Opção 2: Comando PowerShell de 1 Linha */}
            <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-amber-400" />
                  Opção 2: Instalação Silenciosa via PowerShell
                </span>
                <button
                  type="button"
                  onClick={handleCopyCmd}
                  className="flex items-center gap-1 text-[11px] font-semibold text-blue-400 hover:text-blue-300 transition"
                >
                  {copiedCmd ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 font-mono text-[11px] text-slate-300 overflow-x-auto select-all">
                {installCmd}
              </div>
              <p className="text-[10px] text-slate-500">
                Abra o PowerShell como Administrador na máquina do cliente e cole o comando acima.
              </p>
            </div>

            {/* Passo a Passo Ilustrado de 2 Cliques */}
            <div className="space-y-2 pt-1 border-t border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Instruções Rápidas de Conexão:
              </span>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2.5 text-slate-300">
                  <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">
                    1
                  </span>
                  <span>
                    Baixe e execute o instalador no computador do cliente.
                  </span>
                </div>
                <div className="flex items-start gap-2.5 text-slate-300">
                  <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 font-bold text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">
                    2
                  </span>
                  <span>
                    Confirme a permissão de Administrador do Windows (UAC).
                  </span>
                </div>
                <div className="flex items-start gap-2.5 text-slate-300">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">
                    3
                  </span>
                  <span>
                    Pronto! A máquina aparecerá na sua tela com status <strong className="text-emerald-400">ONLINE</strong> para controle com 1 clique.
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end border-t border-slate-800">
              <button
                type="button"
                onClick={onCloseInstaller}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs transition"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
