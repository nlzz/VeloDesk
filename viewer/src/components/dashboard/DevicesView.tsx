import React, { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  ColumnDef,
  flexRender,
  SortingState,
} from '@tanstack/react-table';
import {
  Search,
  Monitor,
  ArrowUpDown,
  Play,
  Tag as TagIcon,
  Folder,
  FolderPlus,
  Download,
  Laptop,
} from 'lucide-react';
import { RemoteDevice, DeviceGroup, DeviceTag, TenantInfo } from '../../services/api';
import { DeviceActionModals } from './DeviceActionModals';

interface DevicesViewProps {
  devices: RemoteDevice[];
  groups: DeviceGroup[];
  tags: DeviceTag[];
  onConnect: (agentId: string) => void;
  isLoading: boolean;
  onRefresh?: () => void;
  tenant?: TenantInfo | null;
}

export const DevicesView: React.FC<DevicesViewProps> = ({
  devices,
  groups,
  tags,
  onConnect,
  isLoading,
  onRefresh,
  tenant,
}) => {
  const [globalFilter, setGlobalFilter] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [sorting, setSorting] = useState<SortingState>([]);

  // Estados de Modais Rápidos
  const [isNewGroupOpen, setIsNewGroupOpen] = useState(false);
  const [isNewTagOpen, setIsNewTagOpen] = useState(false);
  const [isInstallerOpen, setIsInstallerOpen] = useState(false);

  // Filtra dispositivos por grupo e tag antes de alimentar a tabela
  const filteredData = useMemo(() => {
    return devices.filter((d) => {
      if (selectedGroup !== 'all' && d.group_id !== selectedGroup) {
        return false;
      }
      if (selectedTag !== 'all') {
        const hasTag = d.tags?.some((t) => t.id === selectedTag);
        if (!hasTag) return false;
      }
      return true;
    });
  }, [devices, selectedGroup, selectedTag]);

  // Definição das Colunas com TanStack Table
  const columns = useMemo<ColumnDef<RemoteDevice>[]>(
    () => [
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const status = row.original.status;
          const isOnline = status === 'ONLINE';
          return (
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                {isOnline && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    isOnline ? 'bg-emerald-500' : 'bg-slate-600'
                  }`}
                />
              </span>
              <span
                className={`text-xs font-semibold ${
                  isOnline ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {status}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: 'hostname',
        header: ({ column }) => (
          <button
            type="button"
            className="flex items-center gap-1 hover:text-white"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            <span>Nome do Host</span>
            <ArrowUpDown className="w-3 h-3" />
          </button>
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-slate-800 text-blue-400">
              <Monitor className="w-4 h-4" />
            </div>
            <div>
              <div className="font-semibold text-slate-100 text-xs">{row.original.hostname}</div>
              <div className="text-[11px] text-slate-400 font-mono">{row.original.os_info || 'Windows'}</div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'agent_id',
        header: 'ID de Acesso',
        cell: ({ row }) => (
          <span className="font-mono text-xs font-bold text-blue-400 bg-blue-950/40 border border-blue-800/40 px-2 py-0.5 rounded">
            {row.original.agent_id}
          </span>
        ),
      },
      {
        id: 'tags',
        header: 'Etiquetas / Tags',
        cell: ({ row }) => {
          const rowTags = row.original.tags || [];
          return (
            <div className="flex flex-wrap gap-1">
              {rowTags.map((t) => (
                <span
                  key={t.id}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full border text-white shadow-sm"
                  style={{
                    backgroundColor: `${t.color_hex}25`,
                    borderColor: t.color_hex,
                    color: t.color_hex,
                  }}
                >
                  {t.name}
                </span>
              ))}
              {rowTags.length === 0 && <span className="text-slate-500 text-xs">—</span>}
            </div>
          );
        },
      },
      {
        accessorKey: 'last_seen',
        header: 'Último Visto',
        cell: ({ row }) => {
          const date = new Date(row.original.last_seen);
          return (
            <span className="text-xs text-slate-400 font-mono">
              {isNaN(date.getTime()) ? 'Agora' : date.toLocaleTimeString()}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: 'Ação',
        cell: ({ row }) => {
          const isOnline = row.original.status === 'ONLINE';
          return (
            <button
              type="button"
              disabled={!isOnline}
              onClick={() => onConnect(row.original.agent_id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow ${
                isOnline
                  ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
              }`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Conectar</span>
            </button>
          );
        },
      },
    ],
    [onConnect]
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      globalFilter,
      sorting,
    },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* ========================================================================= */}
      {/* 1. BARRA DE AÇÕES RÁPIDAS EM DESTAQUE */}
      {/* ========================================================================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shadow-sm">
            <Laptop className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              Gestão de Computadores
              {tenant?.name && (
                <span className="text-[11px] font-semibold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md border border-slate-700/60">
                  {tenant.name}
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400">
              {devices.length} máquina{devices.length === 1 ? '' : 's'} registrada{devices.length === 1 ? '' : 's'} no escritório
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Botão + Novo Grupo */}
          <button
            type="button"
            onClick={() => setIsNewGroupOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 transition shadow-sm hover:border-blue-400 cursor-pointer"
            title="Criar novo grupo de computadores (ex: Contabilidade, Fiscal, Servidores)"
          >
            <FolderPlus className="w-4 h-4 text-blue-400" />
            <span>+ Novo Grupo</span>
          </button>

          {/* Botão + Nova Tag */}
          <button
            type="button"
            onClick={() => setIsNewTagOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition shadow-sm hover:border-emerald-400 cursor-pointer"
            title="Criar nova etiqueta colorida (ex: VIP, Crítico, Recepção)"
          >
            <TagIcon className="w-4 h-4 text-emerald-400" />
            <span>+ Nova Tag</span>
          </button>

          {/* Botão 📥 Baixar Instalador / Conectar Máquina */}
          <button
            type="button"
            onClick={() => setIsInstallerOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white shadow-lg shadow-indigo-500/25 transition cursor-pointer"
            title="Baixar instalador do agente para conectar computadores a este escritório"
          >
            <Download className="w-4 h-4" />
            <span>📥 Baixar Instalador / Conectar Máquina</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. ESTADO VAZIO: CARD CENTRAL ILUSTRADO DE BOAS-VINDAS */}
      {/* ========================================================================= */}
      {devices.length === 0 && !isLoading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 sm:p-12 shadow-xl text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white mx-auto shadow-lg shadow-indigo-500/30">
            <Monitor className="w-8 h-8" />
          </div>

          <div className="max-w-xl mx-auto space-y-2">
            <h3 className="text-xl font-bold text-slate-100">
              Nenhum computador conectado ao escritório ainda
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Conecte sua primeira máquina em menos de 2 minutos. O agente VeloDesk opera silenciosamente em segundo plano, com suporte a UAC e conexão P2P de alta performance.
            </p>
          </div>

          {/* 3 Passos Claros de Conexão */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto text-left pt-2">
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2 relative overflow-hidden">
              <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center border border-blue-500/30">
                1
              </div>
              <h4 className="text-xs font-bold text-slate-200">Baixe o instalador</h4>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Baixe o instalador personalizado pré-vinculado ao escritório <span className="text-blue-400 font-mono font-semibold">{tenant?.slug || 'simcontabil'}</span>.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2 relative overflow-hidden">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 font-bold text-xs flex items-center justify-center border border-indigo-500/30">
                2
              </div>
              <h4 className="text-xs font-bold text-slate-200">Execute no cliente</h4>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Execute com 2 cliques na máquina do cliente. O serviço Windows é registrado automaticamente com privilégios de sistema.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2 relative overflow-hidden">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center border border-emerald-500/30">
                3
              </div>
              <h4 className="text-xs font-bold text-slate-200">Pronto para conexão</h4>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                A máquina surgirá automaticamente nesta tela com status ONLINE, pronta para suporte e controle remoto imediato.
              </p>
            </div>
          </div>

          {/* Botões de Ação do Card */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setIsInstallerOpen(true)}
              className="px-6 py-3 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white shadow-xl shadow-indigo-500/30 transition flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>📥 Baixar Instalador do Escritório Agora</span>
            </button>

            <button
              type="button"
              onClick={() => setIsNewGroupOpen(true)}
              className="px-4 py-3 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 transition flex items-center gap-1.5 cursor-pointer"
            >
              <FolderPlus className="w-4 h-4 text-blue-400" />
              <span>+ Criar Primeiro Grupo</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ========================================================================= */}
          {/* 3. BARRA DE BUSCA E FILTROS */}
          {/* ========================================================================= */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
            {/* Campo de Busca Global */}
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                id="search-devices-input"
                name="search_devices_query"
                autoComplete="off"
                value={globalFilter ?? ''}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder="Buscar por hostname ou ID..."
                className="w-full bg-slate-800/80 border border-slate-700/60 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Filtro por Grupo e Tag */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl px-2.5 py-1.5 text-xs text-slate-300">
                <Folder className="w-3.5 h-3.5 text-slate-400" />
                <select
                  id="filter-group-select"
                  name="filter_group"
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  className="bg-transparent border-none text-xs text-slate-200 focus:outline-none cursor-pointer"
                >
                  <option value="all">Todos os Grupos</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id} className="bg-slate-900">
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl px-2.5 py-1.5 text-xs text-slate-300">
                <TagIcon className="w-3.5 h-3.5 text-slate-400" />
                <select
                  id="filter-tag-select"
                  name="filter_tag"
                  value={selectedTag}
                  onChange={(e) => setSelectedTag(e.target.value)}
                  className="bg-transparent border-none text-xs text-slate-200 focus:outline-none cursor-pointer"
                >
                  <option value="all">Todas as Tags</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id} className="bg-slate-900">
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 4. TABELA DE DISPOSITIVOS */}
          {/* ========================================================================= */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id} className="bg-slate-800/60 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      {headerGroup.headers.map((header) => (
                        <th key={header.id} className="px-4 py-3">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-800/30 transition">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-3.5 text-xs">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {table.getRowModel().rows.length === 0 && !isLoading && (
                    <tr>
                      <td colSpan={columns.length} className="px-4 py-12 text-center space-y-3">
                        <p className="text-slate-400 text-xs">
                          Nenhum computador encontrado com os filtros selecionados.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setGlobalFilter('');
                            setSelectedGroup('all');
                            setSelectedTag('all');
                          }}
                          className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 transition cursor-pointer"
                        >
                          Limpar Filtros
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Rodapé e Paginação */}
            <div className="px-4 py-3 bg-slate-850 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <div>
                Total: <span className="font-semibold text-slate-200">{filteredData.length}</span> máquina{filteredData.length === 1 ? '' : 's'} listada{filteredData.length === 1 ? '' : 's'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-xs"
                >
                  Anterior
                </button>
                <span className="font-mono text-[11px]">
                  Pág. {table.getState().pagination.pageIndex + 1} de {table.getPageCount() || 1}
                </span>
                <button
                  type="button"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-xs"
                >
                  Próxima
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ========================================================================= */}
      {/* 5. MODAIS DE AÇÕES RÁPIDAS (NOVO GRUPO, NOVA TAG, INSTALADOR) */}
      {/* ========================================================================= */}
      <DeviceActionModals
        tenant={tenant}
        groups={groups}
        isNewGroupOpen={isNewGroupOpen}
        onCloseNewGroup={() => setIsNewGroupOpen(false)}
        onGroupCreated={() => onRefresh?.()}
        isNewTagOpen={isNewTagOpen}
        onCloseNewTag={() => setIsNewTagOpen(false)}
        onTagCreated={() => onRefresh?.()}
        isInstallerOpen={isInstallerOpen}
        onCloseInstaller={() => setIsInstallerOpen(false)}
      />
    </div>
  );
};
