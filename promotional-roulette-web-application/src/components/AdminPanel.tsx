"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Check,
  Download,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Shield,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Sector = {
  id: string;
  name: string;
  description: string;
  color: string;
  position: number;
  weight: string | null;
  active: boolean;
};

type State = {
  available: boolean;
  configured: boolean;
  sectors: Sector[];
};

type Spin = {
  id: string;
  requestId: string;
  sectorName: string;
  sectorPosition: number;
  selectedWeight: string;
  createdAt: string;
};

type HistoryData = {
  items: Spin[];
  breakdown: { sectorName: string; count: number }[];
  page: number;
  pages: number;
  total: number;
};

const BRAND_SWATCHES = [
  { label: "Marinho", color: "#0a2a63" },
  { label: "Azul", color: "#0f63e8" },
  { label: "Prata", color: "#dfe7f1" },
  { label: "Ciano", color: "#1479f2" },
];

export default function AdminPanel() {
  const [auth, setAuth] = useState<{ setupRequired: boolean; authenticated: boolean } | null>(
    null
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<"sectors" | "history" | "security">("sectors");
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [saved, setSaved] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const loadState = useCallback(async () => {
    const response = await fetch("/api/admin/state", { cache: "no-store" });
    if (response.ok) {
      setState(await response.json());
    } else if (response.status === 401) {
      setAuth((a) => (a ? { ...a, authenticated: false } : a));
    }
  }, []);

  useEffect(() => {
    fetch("/api/admin/auth/status", { cache: "no-store" })
      .then((r) => r.json())
      .then(setAuth);
  }, []);

  useEffect(() => {
    if (auth?.authenticated) loadState();
  }, [auth, loadState]);

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const endpoint = auth?.setupRequired ? "/api/admin/auth/setup" : "/api/admin/auth/login";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) return setError(data.error || "Falha na autenticação.");
    setAuth({ setupRequired: false, authenticated: true });
    setPassword("");
  }

  async function logout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    setState(null);
    setAuth({ setupRequired: false, authenticated: false });
  }

  function updateSector(id: string, patch: Partial<Sector>) {
    setState((current) =>
      current
        ? {
            ...current,
            sectors: current.sectors.map((s) => (s.id === id ? { ...s, ...patch } : s)),
          }
        : current
    );
    setSaved(false);
  }

  function moveSector(index: number, direction: -1 | 1) {
    if (!state) return;
    const next = [...state.sectors];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setState({
      ...state,
      sectors: next.map((s, position) => ({ ...s, position })),
    });
    setSaved(false);
  }

  function addSector() {
    if (!state || state.sectors.length >= 24) return;
    const position = state.sectors.length;
    const swatch = BRAND_SWATCHES[position % BRAND_SWATCHES.length].color;
    setState({
      ...state,
      sectors: [
        ...state.sectors,
        {
          id: `new-${crypto.randomUUID()}`,
          name: "NOVO PRÊMIO",
          description: "",
          color: swatch,
          position,
          weight: null,
          active: true,
        },
      ],
    });
    setSaved(false);
  }

  function removeSector(id: string) {
    if (!state || state.sectors.length <= 2) {
      setError("A roleta precisa manter pelo menos 2 setores.");
      return;
    }
    const filtered = state.sectors
      .filter((s) => s.id !== id)
      .map((s, position) => ({ ...s, position }));
    setState({ ...state, sectors: filtered });
    setSaved(false);
  }

  function fillMissingWeightsWithOne() {
    if (!state) return;
    setState({
      ...state,
      sectors: state.sectors.map((s) => ({
        ...s,
        weight: s.weight && Number(s.weight) > 0 ? s.weight : "1",
      })),
    });
    setSaved(false);
    setNotice("Pesos preenchidos no formulário. Clique em SALVAR ALTERAÇÕES para gravar no servidor.");
  }

  async function resetDefaultSectors() {
    setLoading(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/admin/sectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_defaults" }),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) return setError(data.error || "Não foi possível restaurar.");
    setNotice("Os 8 setores de referência foram restaurados em modo de configuração.");
    await loadState();
  }

  async function saveSectors() {
    if (!state) return;
    setLoading(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/admin/sectors", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectors: state.sectors }),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) return setError(data.error || "Erro ao salvar setores.");
    setSaved(true);
    setNotice("Configurações dos setores salvas com sucesso.");
    await loadState();
    window.setTimeout(() => setSaved(false), 2600);
  }

  async function toggleAvailability() {
    if (!state) return;
    setLoading(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available: !state.available }),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) return setError(data.error || "Não foi possível alterar a disponibilidade.");
    setState({ ...state, available: data.available });
    setNotice(
      data.available
        ? "A roleta está PUBLICADA e operando com sorteios reais."
        : "A roleta foi colocada em MODO DE CONFIGURAÇÃO / DEMONSTRAÇÃO."
    );
  }

  const loadHistory = useCallback(
    async (page = 1, q = searchQuery) => {
      const params = new URLSearchParams({ page: String(page) });
      if (q.trim()) params.set("q", q.trim());
      const response = await fetch(`/api/admin/history?${params.toString()}`, {
        cache: "no-store",
      });
      if (response.ok) setHistory(await response.json());
    },
    [searchQuery]
  );

  useEffect(() => {
    if (tab === "history" && auth?.authenticated) {
      loadHistory(1, searchQuery);
    }
  }, [tab, auth, loadHistory, searchQuery]);

  function exportHistoryCsv() {
    if (!history || !history.items.length) return;
    const header = "ID,DataHora,Setor,Posicao,Peso\n";
    const rows = history.items
      .map(
        (s) =>
          `"${s.id}","${new Date(s.createdAt).toISOString()}","${s.sectorName.replace(
            /"/g,
            '""'
          )}",${s.sectorPosition + 1},${s.selectedWeight}`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `historico-roleta-fator-reducao.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/admin/auth/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) return setError(data.error || "Não foi possível alterar a senha.");
    setCurrentPassword("");
    setNewPassword("");
    setNotice("Senha administrativa atualizada com sucesso.");
  }

  const totalWeight = useMemo(
    () =>
      state?.sectors
        .filter((s) => s.active && s.weight !== null && s.weight !== "" && Number(s.weight) > 0)
        .reduce((sum, s) => sum + Number(s.weight), 0) ?? 0,
    [state]
  );

  const allActiveHaveWeights = useMemo(() => {
    if (!state) return false;
    const active = state.sectors.filter((s) => s.active);
    return (
      active.length > 0 &&
      active.every((s) => s.weight !== null && s.weight !== "" && Number(s.weight) > 0)
    );
  }, [state]);

  if (!auth) {
    return (
      <div className="admin-loading">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!auth.authenticated) {
    return (
      <main className="auth-page">
        <div className="auth-glow" />
        <Link href="/" className="back-public">
          <ArrowLeft size={16} /> Voltar à roleta pública
        </Link>
        <form className="auth-card" onSubmit={authenticate}>
          <img src="/assets/fator-icone-transparente.png" alt="Fator Redução" />
          <div className="auth-shield">
            <Shield />
          </div>
          <span>ÁREA ADMINISTRATIVA PROTEGIDA</span>
          <h1>
            {auth.setupRequired ? "Configurar Senha do Administrador" : "Acessar Painel"}
          </h1>
          <p>
            {auth.setupRequired
              ? "Defina a senha administrativa inicial (mínimo de 10 caracteres). Ela será armazenada com hash criptográfico scrypt no servidor."
              : "Informe sua senha administrativa para gerenciar setores, probabilidades, disponibilidade e histórico."}
          </p>
          <label>
            Senha administrativa
            <div className="password-field">
              <input
                autoFocus
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={auth.setupRequired ? 10 : undefined}
                required
                placeholder={
                  auth.setupRequired ? "Mínimo de 10 caracteres" : "Digite sua senha"
                }
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label="Mostrar ou ocultar senha"
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-admin" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {auth.setupRequired ? "CRIAR ACESSO SEGURO" : "ENTRAR NO PAINEL"}
          </button>
        </form>
      </main>
    );
  }

  if (!state) {
    return (
      <div className="admin-loading">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <main className="admin-page">
      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <img src="/assets/fator-icone-transparente.png" alt="Fator Redução" />
          <div>
            <b>FATOR</b>
            <span>REDUÇÃO</span>
          </div>
        </div>
        <nav>
          <button
            type="button"
            className={tab === "sectors" ? "active" : ""}
            onClick={() => setTab("sectors")}
          >
            <Settings2 /> <span>Setores e Chances</span>
          </button>
          <button
            type="button"
            className={tab === "history" ? "active" : ""}
            onClick={() => setTab("history")}
          >
            <History /> <span>Histórico de Giros</span>
          </button>
          <button
            type="button"
            className={tab === "security" ? "active" : ""}
            onClick={() => setTab("security")}
          >
            <KeyRound /> <span>Segurança</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <Link href="/">
            <ArrowLeft /> <span>Ver roleta pública</span>
          </Link>
          <button type="button" onClick={logout}>
            <LogOut /> <span>Encerrar sessão</span>
          </button>
        </div>
      </aside>

      <section className="admin-content">
        <header className="admin-topbar">
          <div>
            <span>CENTRAL DE CONTROLE • FATOR REDUÇÃO</span>
            <h1>
              {tab === "sectors"
                ? "Setores, Pesos e Disponibilidade"
                : tab === "history"
                ? "Histórico Auditável de Giros"
                : "Segurança da Conta Administrativa"}
            </h1>
          </div>
          <div className={`status-badge ${state.available ? "online" : "offline"}`}>
            <i />
            <span>{state.available ? "ROLETA PUBLICADA" : "MODO CONFIGURAÇÃO"}</span>
          </div>
        </header>

        {error && (
          <div className="admin-alert is-error">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button type="button" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}

        {notice && (
          <div className="admin-alert is-notice">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" />
              <span>{notice}</span>
            </div>
            <button type="button" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}

        {tab === "sectors" && (
          <>
            <div className="summary-grid">
              <div>
                <span>SETORES CADASTRADOS</span>
                <strong>{state.sectors.length}</strong>
                <small>{state.sectors.filter((s) => s.active).length} setores ativos na roleta</small>
              </div>
              <div>
                <span>STATUS DAS PROBABILIDADES</span>
                <strong>{state.configured ? "Configuradas" : "Pendentes"}</strong>
                <small>
                  {state.configured
                    ? `Soma total de pesos: ${totalWeight.toFixed(2)}`
                    : "Defina pesos positivos em todos os setores ativos e salve"}
                </small>
              </div>
              <div>
                <span>DISPONIBILIDADE PÚBLICA</span>
                <button
                  type="button"
                  className={state.available ? "availability on" : "availability"}
                  onClick={toggleAvailability}
                  disabled={loading}
                >
                  {state.available ? <ToggleRight /> : <ToggleLeft />}
                  <span>
                    {state.available ? "Roleta Ativa (Sorteio Valendo)" : "Em Demonstração"}
                  </span>
                </button>
                <small>
                  {state.configured
                    ? "Clique para alternar entre sorteio real e demonstração"
                    : "Salve os pesos de todos os setores ativos antes de ativar"}
                </small>
              </div>
            </div>

            {/* Visual Probability Distribution Bar */}
            {allActiveHaveWeights && totalWeight > 0 && (
              <div className="prob-bar-card">
                <div className="prob-bar-header">
                  <span>DISTRIBUIÇÃO PROPORCIONAL DE PROBABILIDADES</span>
                  <span>SOMA DOS PESOS: {totalWeight.toFixed(2)}</span>
                </div>
                <div className="prob-bar-track">
                  {state.sectors
                    .filter((s) => s.active && Number(s.weight) > 0)
                    .map((s) => {
                      const pct = (Number(s.weight) / totalWeight) * 100;
                      return (
                        <div
                          key={s.id}
                          style={{
                            width: `${pct}%`,
                            backgroundColor: s.color,
                          }}
                          title={`${s.name}: ${pct.toFixed(2)}%`}
                        />
                      );
                    })}
                </div>
              </div>
            )}

            <div className="section-heading">
              <div>
                <h2>Ordem horária a partir do topo (12h)</h2>
                <p>
                  Edite nome, descrição de resgate, cor, ordem e peso de cada setor. As chances
                  são aplicadas exclusivamente no servidor.
                </p>
              </div>
              <div className="admin-toolbar-actions">
                <button
                  type="button"
                  className="secondary-admin-btn"
                  onClick={fillMissingWeightsWithOne}
                  disabled={loading}
                  title="Preenche peso 1 nos setores ainda sem peso definido"
                >
                  <Sparkles />
                  <span>Preencher Pesos = 1</span>
                </button>
                <button
                  type="button"
                  className="secondary-admin-btn"
                  onClick={ addSector }
                  disabled={loading || state.sectors.length >= 24}
                >
                  <Plus />
                  <span>Novo Setor</span>
                </button>
                <button
                  type="button"
                  className="secondary-admin-btn"
                  onClick={resetDefaultSectors}
                  disabled={loading}
                >
                  <RotateCcw />
                  <span>Restaurar 8 Padrão</span>
                </button>
                <button
                  type="button"
                  className="save-button"
                  onClick={saveSectors}
                  disabled={loading}
                >
                  {saved ? (
                    <Check />
                  ) : loading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Save />
                  )}
                  <span>{saved ? "SALVO!" : "SALVAR ALTERAÇÕES"}</span>
                </button>
              </div>
            </div>

            <div className="sector-list">
              {state.sectors.map((sector, index) => {
                const chance =
                  sector.active && sector.weight && totalWeight > 0
                    ? (Number(sector.weight) / totalWeight) * 100
                    : 0;
                return (
                  <article
                    className={`sector-editor ${!sector.active ? "inactive" : ""}`}
                    key={sector.id}
                  >
                    <div className="order-controls">
                      <button
                        type="button"
                        onClick={() => moveSector(index, -1)}
                        disabled={index === 0}
                        aria-label="Mover para cima"
                      >
                        <ArrowUp />
                      </button>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <button
                        type="button"
                        onClick={() => moveSector(index, 1)}
                        disabled={index === state.sectors.length - 1}
                        aria-label="Mover para baixo"
                      >
                        <ArrowDown />
                      </button>
                    </div>

                    <div className="color-control">
                      <input
                        type="color"
                        value={sector.color}
                        onChange={(e) => updateSector(sector.id, { color: e.target.value })}
                        aria-label={`Cor do setor ${sector.name}`}
                      />
                      <div className="swatch-row">
                        {BRAND_SWATCHES.map((sw) => (
                          <button
                            key={sw.color}
                            type="button"
                            onClick={() => updateSector(sector.id, { color: sw.color })}
                            style={{ backgroundColor: sw.color }}
                            title={sw.label}
                            className="swatch-dot"
                          />
                        ))}
                      </div>
                    </div>

                    <label className="field name-field">
                      <span>NOME DO SETOR</span>
                      <input
                        value={sector.name}
                        maxLength={60}
                        onChange={(e) => updateSector(sector.id, { name: e.target.value })}
                      />
                    </label>

                    <label className="field description-field">
                      <span>DESCRIÇÃO / INSTRUÇÃO DE RESGATE</span>
                      <input
                        value={sector.description}
                        maxLength={240}
                        placeholder="Ex.: Apresente o protocolo ao consultor"
                        onChange={(e) =>
                          updateSector(sector.id, { description: e.target.value })
                        }
                      />
                    </label>

                    <label className="field weight-field">
                      <span>PESO / CHANCE</span>
                      <input
                        type="number"
                        min="0.0001"
                        step="0.1"
                        value={sector.weight ?? ""}
                        placeholder="Definir peso"
                        onChange={(e) =>
                          updateSector(sector.id, { weight: e.target.value || null })
                        }
                      />
                      <small>
                        {sector.active && sector.weight && Number(sector.weight) > 0
                          ? `${chance.toFixed(2)}% de probabilidade`
                          : "Sem peso definido"}
                      </small>
                    </label>

                    <div className="sector-actions-col">
                      <button
                        type="button"
                        className={`active-toggle ${sector.active ? "on" : ""}`}
                        onClick={() => updateSector(sector.id, { active: !sector.active })}
                      >
                        {sector.active ? <ToggleRight /> : <ToggleLeft />}
                        <span>{sector.active ? "ATIVO" : "INATIVO"}</span>
                      </button>
                      <button
                        type="button"
                        className="delete-sector-btn"
                        onClick={() => removeSector(sector.id)}
                        disabled={state.sectors.length <= 2}
                        title="Remover setor"
                        aria-label={`Remover ${sector.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}

        {tab === "history" && (
          <div className="history-panel">
            <div className="history-top-grid">
              <div className="history-summary">
                <BarChart3 />
                <div>
                  <strong>{history?.total ?? 0}</strong>
                  <span>GIROS VÁLIDOS REGISTRADOS</span>
                </div>
              </div>

              <div className="history-breakdown-card">
                <span className="breakdown-title">CONTAGEM POR PRÊMIO SORTEADO</span>
                {history?.breakdown?.length ? (
                  <div className="breakdown-chips">
                    {history.breakdown.map((b) => (
                      <div key={b.sectorName} className="breakdown-chip">
                        <span>{b.sectorName}</span>
                        <b>{b.count}x</b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#7187a6]">
                    Os totais por prêmio aparecerão assim que houver giros oficiais.
                  </p>
                )}
              </div>
            </div>

            <div className="history-toolbar">
              <div className="history-search">
                <Search className="h-4 w-4 text-[#6d87ad]" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filtrar por nome do setor..."
                />
              </div>
              <button
                type="button"
                onClick={exportHistoryCsv}
                disabled={!history?.items?.length}
                className="secondary-admin-btn"
              >
                <Download />
                <span>Exportar CSV</span>
              </button>
            </div>

            <div className="history-table">
              <div className="history-row heading">
                <span>DATA E HORA</span>
                <span>PRÊMIO SORTEADO</span>
                <span>SETOR</span>
                <span>PESO APLICADO</span>
                <span>PROTOCOLO</span>
              </div>
              {history?.items.length ? (
                history.items.map((spin) => (
                  <div className="history-row" key={spin.id}>
                    <span>
                      {new Intl.DateTimeFormat("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "medium",
                      }).format(new Date(spin.createdAt))}
                    </span>
                    <strong>{spin.sectorName}</strong>
                    <span>#{spin.sectorPosition + 1}</span>
                    <span>{Number(spin.selectedWeight).toLocaleString("pt-BR")}</span>
                    <span className="font-mono text-xs text-[#69bfff]">
                      #{spin.id.slice(0, 8).toUpperCase()}
                    </span>
                  </div>
                ))
              ) : (
                <div className="empty-history">
                  Nenhum giro válido encontrado para o filtro atual.
                </div>
              )}
            </div>

            {history && history.pages > 1 && (
              <div className="pagination">
                <button
                  type="button"
                  disabled={history.page <= 1}
                  onClick={() => loadHistory(history.page - 1, searchQuery)}
                >
                  Anterior
                </button>
                <span>
                  Página {history.page} de {history.pages}
                </span>
                <button
                  type="button"
                  disabled={history.page >= history.pages}
                  onClick={() => loadHistory(history.page + 1, searchQuery)}
                >
                  Próxima
                </button>
              </div>
            )}
          </div>
        )}

        {tab === "security" && (
          <form className="security-card" onSubmit={handlePasswordChange}>
            <h2>Alterar senha administrativa</h2>
            <p>
              Atualize a credencial de acesso ao painel. Todas as senhas são derivadas no
              servidor via scrypt com salt exclusivo.
            </p>
            <label className="field">
              <span>SENHA ATUAL</span>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Digite sua senha atual"
              />
            </label>
            <label className="field">
              <span>NOVA SENHA (MÍNIMO 10 CARACTERES)</span>
              <input
                type="password"
                required
                minLength={10}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Digite a nova senha"
              />
            </label>
            <button type="submit" className="save-button mt-4" disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <Save />}
              <span>ATUALIZAR SENHA</span>
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
