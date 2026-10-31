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
import { Search, Monitor, ArrowUpDown, Play, Tag as TagIcon, Folder } from 'lucide-react';
import { RemoteDevice, DeviceGroup, DeviceTag } from '../../services/api';

interface DevicesViewProps {
  devices: RemoteDevice[];
  groups: DeviceGroup[];
  tags: DeviceTag[];
  onConnect: (agentId: string) => void;
  isLoading: boolean;
}

export const DevicesView: React.FC<DevicesViewProps> = ({
  devices,
  groups,
  tags,
  onConnect,
  isLoading,
}) => {
  const [globalFilter, setGlobalFilter] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [sorting, setSorting] = useState<SortingState>([]);

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
      {/* Barra de Filtros e Busca */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
        {/* Campo de Busca Global */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
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

      {/* Tabela de Dispositivos */}
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
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400 text-xs">
                    Nenhum dispositivo encontrado para os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Rodapé e Paginação */}
        <div className="px-4 py-3 bg-slate-850 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            Total: <span className="font-semibold text-slate-200">{filteredData.length}</span> máquinas registradas
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
    </div>
  );
};
