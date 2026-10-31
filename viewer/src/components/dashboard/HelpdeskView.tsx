import React, { useState } from 'react';
import {
  LifeBuoy,
  MessageSquare,
  Send,
  Eye,
  X,
  Zap,
} from 'lucide-react';
import { HelpdeskTicket, TicketMessage, api } from '../../services/api';

interface HelpdeskViewProps {
  tickets: HelpdeskTicket[];
  onConnectToTicket: (agentId: string) => void;
  onRefresh: () => void;
  currentTechName: string;
}

export const HelpdeskView: React.FC<HelpdeskViewProps> = ({
  tickets,
  onConnectToTicket,
  onRefresh,
  currentTechName,
}) => {
  const [selectedTicket, setSelectedTicket] = useState<HelpdeskTicket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [previewScreenshot, setPreviewScreenshot] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const filteredTickets = tickets.filter((t) => {
    if (statusFilter === 'ALL') return true;
    return t.status === statusFilter;
  });

  const handleOpenChat = async (ticket: HelpdeskTicket) => {
    setSelectedTicket(ticket);
    setIsLoadingMessages(true);
    try {
      const msgs = await api.listTicketMessages(ticket.id);
      setMessages(msgs);
    } catch (err) {
      console.error('[Helpdesk] Erro ao carregar mensagens:', err);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !newMessage.trim()) return;

    try {
      const created = await api.sendTicketMessage(selectedTicket.id, newMessage.trim(), currentTechName, 'TECH');
      setMessages((prev) => [...prev, created]);
      setNewMessage('');
    } catch (err) {
      console.error('[Helpdesk] Falha ao enviar mensagem:', err);
    }
  };

  const handleStatusChange = async (ticketId: string, newStatus: string) => {
    try {
      await api.updateTicketStatus(ticketId, newStatus);
      if (selectedTicket && selectedTicket.id === ticketId) {
        setSelectedTicket({ ...selectedTicket, status: newStatus as any });
      }
      onRefresh();
    } catch (err) {
      console.error('[Helpdesk] Erro ao atualizar status:', err);
    }
  };

  return (
    <div className="space-y-4">
      {/* Barra de Filtro de Chamados */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LifeBuoy className="w-4 h-4 text-blue-400" />
          <span className="font-semibold text-xs text-slate-200">Fila de Chamados e Helpdesk Integrado</span>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
          {(['ALL', 'PENDING', 'IN_PROGRESS', 'RESOLVED'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                statusFilter === st
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {st === 'ALL' && 'Todos'}
              {st === 'PENDING' && 'Pendentes'}
              {st === 'IN_PROGRESS' && 'Em Atendimento'}
              {st === 'RESOLVED' && 'Resolvidos'}
            </button>
          ))}
        </div>
      </div>

      {/* Grid de Lista de Chamados */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Coluna da Esquerda: Cards de Chamados */}
        <div className="lg:col-span-2 space-y-3">
          {filteredTickets.map((ticket) => {
            const isSelected = selectedTicket?.id === ticket.id;
            return (
              <div
                key={ticket.id}
                className={`bg-slate-900 border transition rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between ${
                  isSelected ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        ticket.status === 'PENDING'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : ticket.status === 'IN_PROGRESS'
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      {ticket.status}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      {new Date(ticket.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <h3 className="font-bold text-sm text-slate-100">{ticket.subject}</h3>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span>Solicitante: <strong className="text-slate-200">{ticket.requester_name}</strong></span>
                    {ticket.agent_id && (
                      <span className="font-mono text-blue-400 bg-blue-950/40 px-1.5 py-0.2 rounded border border-blue-800/40">
                        {ticket.agent_id}
                      </span>
                    )}
                  </div>
                </div>

                {/* Print Anexado e Ações */}
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  {ticket.screenshot_data && (
                    <button
                      type="button"
                      onClick={() => setPreviewScreenshot(ticket.screenshot_data || null)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition"
                      title="Ver print anexado da tela"
                    >
                      <Eye className="w-4 h-4 text-blue-400" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleOpenChat(ticket)}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition"
                    title="Abrir chat do chamado"
                  >
                    <MessageSquare className="w-4 h-4 text-emerald-400" />
                  </button>

                  {/* BOTÃO MÁGICO: Conectar e Assumir Controle */}
                  {ticket.agent_id && (
                    <button
                      type="button"
                      onClick={() => {
                        handleStatusChange(ticket.id, 'IN_PROGRESS');
                        onConnectToTicket(ticket.agent_id || '');
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-md transition"
                    >
                      <Zap className="w-3.5 h-3.5 fill-current" />
                      <span>Conectar e Assumir</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {filteredTickets.length === 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 text-xs">
              Nenhum chamado encontrado com o filtro atual.
            </div>
          )}
        </div>

        {/* Coluna da Direita: Chat em Tempo Real do Chamado Selecionado */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col h-[520px]">
          {selectedTicket ? (
            <>
              {/* Header do Chat */}
              <div className="border-b border-slate-800 pb-3 mb-3 flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-xs text-slate-100 truncate max-w-[200px]">
                    {selectedTicket.subject}
                  </h4>
                  <div className="text-[11px] text-slate-400">
                    Com {selectedTicket.requester_name}
                  </div>
                </div>

                {/* Status Switcher */}
                <select
                  value={selectedTicket.status}
                  onChange={(e) => handleStatusChange(selectedTicket.id, e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg text-[11px] font-semibold text-slate-200 px-2 py-1 focus:outline-none"
                >
                  <option value="PENDING">PENDING</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="RESOLVED">RESOLVED</option>
                </select>
              </div>

              {/* Mensagens */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
                {isLoadingMessages ? (
                  <div className="text-center text-slate-500 py-8">Carregando mensagens...</div>
                ) : (
                  messages.map((m) => {
                    const isTech = m.sender_type === 'TECH';
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isTech ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs shadow-sm ${
                            isTech
                              ? 'bg-blue-600 text-white rounded-tr-none'
                              : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700/60'
                          }`}
                        >
                          <div className="text-[10px] opacity-75 font-semibold mb-0.5">{m.sender_name}</div>
                          <div>{m.message}</div>
                        </div>
                        <span className="text-[9px] text-slate-500 mt-0.5 font-mono">
                          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })
                )}
                {messages.length === 0 && !isLoadingMessages && (
                  <div className="text-center text-slate-500 py-12">
                    Nenhuma mensagem no chat. Envie uma mensagem para iniciar o atendimento.
                  </div>
                )}
              </div>

              {/* Input de Envio de Mensagem */}
              <form onSubmit={handleSendMessage} className="mt-3 pt-3 border-t border-slate-800 flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Escreva uma mensagem..."
                  className="flex-1 bg-slate-800 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim()}
                  className="p-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold transition shadow"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs text-center p-6">
              <MessageSquare className="w-8 h-8 text-slate-600 mb-2" />
              Selecione um chamado ao lado para visualizar os detalhes e conversar com o cliente em tempo real.
            </div>
          )}
        </div>
      </div>

      {/* Modal de Screenshot em Alta Resolução */}
      {previewScreenshot && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full p-4 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="font-bold text-sm text-slate-100">Print Anexado do Chamado</h3>
              <button
                type="button"
                onClick={() => setPreviewScreenshot(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-[75vh] overflow-auto rounded-xl bg-black flex justify-center">
              <img src={previewScreenshot} alt="Print do erro" className="max-w-full h-auto object-contain" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
