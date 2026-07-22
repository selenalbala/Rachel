import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRoundPlus,
  Users,
  X
} from "lucide-react";
import { api, getToken, setToken } from "./api";
import type { Client, Product, User } from "./types";

type Page = "dashboard" | "clients" | "stock";

const emptyClient = {
  name: "",
  phone: "",
  email: "",
  birthday: "",
  allergies: "",
  notes: ""
};

const emptyProduct = {
  name: "",
  brand: "",
  category: "",
  supplier: "",
  sku: "",
  cost: 0,
  price: 0,
  quantity: 0,
  minimum: 0,
  notes: ""
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoadingSession(false);
      return;
    }

    api<User>("/auth/me")
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoadingSession(false));
  }, []);

  if (loadingSession) return <div className="screen-center">Cargando Rachel Studio…</div>;
  if (!user) return <Login onLogin={setUser} />;

  return <Workspace user={user} onLogout={() => { setToken(null); setUser(null); }} />;
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("admin@rachelstudio.es");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSending(true);

    try {
      const result = await api<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      setToken(result.token);
      onLogin(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand-mark">RS</div>
        <p className="eyebrow">Gestión profesional</p>
        <h1>Rachel Studio</h1>
        <p className="muted">Accede al panel de gestión de clientas y almacén.</p>

        <form onSubmit={submit} className="form-stack">
          <label>Correo<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
          <label>Contraseña<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
          {error && <div className="error-box">{error}</div>}
          <button className="primary-button" disabled={sending}>{sending ? "Entrando…" : "Iniciar sesión"}</button>
        </form>
      </section>
    </main>
  );
}

function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [page, setPage] = useState<Page>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);

  const title = page === "dashboard" ? "Resumen" : page === "clients" ? "Clientas" : "Stock";

  function navigate(next: Page) {
    setPage(next);
    setMobileOpen(false);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-head">
          <div className="brand-small">RS</div>
          <div><strong>Rachel Studio</strong><span>Panel de gestión</span></div>
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(false)}><X size={20} /></button>
        </div>

        <nav>
          <button className={page === "dashboard" ? "active" : ""} onClick={() => navigate("dashboard")}><LayoutDashboard size={19} />Resumen</button>
          <button className={page === "clients" ? "active" : ""} onClick={() => navigate("clients")}><Users size={19} />Clientas</button>
          <button className={page === "stock" ? "active" : ""} onClick={() => navigate("stock")}><Boxes size={19} />Stock</button>
        </nav>

        <div className="sidebar-user">
          <div><strong>{user.name}</strong><span>{user.email}</span></div>
          <button className="icon-button" title="Cerrar sesión" onClick={onLogout}><LogOut size={18} /></button>
        </div>
      </aside>

      {mobileOpen && <div className="overlay" onClick={() => setMobileOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(true)}><Menu /></button>
          <div><p className="eyebrow">Rachel Studio</p><h2>{title}</h2></div>
        </header>

        {page === "dashboard" && <Dashboard goTo={navigate} />}
        {page === "clients" && <ClientsPage />}
        {page === "stock" && <StockPage />}
      </main>
    </div>
  );
}

function Dashboard({ goTo }: { goTo: (page: Page) => void }) {
  const [stats, setStats] = useState({ clients: 0, products: 0, lowStock: 0 });

  useEffect(() => {
    api<typeof stats>("/dashboard").then(setStats).catch(console.error);
  }, []);

  return (
    <section className="page">
      <div className="stats-grid">
        <article className="stat-card"><span>Clientas registradas</span><strong>{stats.clients}</strong><Users /></article>
        <article className="stat-card"><span>Productos registrados</span><strong>{stats.products}</strong><Boxes /></article>
        <article className={`stat-card ${stats.lowStock > 0 ? "warning" : ""}`}><span>Productos bajo mínimo</span><strong>{stats.lowStock}</strong><PackagePlus /></article>
      </div>

      <div className="content-card">
        <div className="section-heading"><div><p className="eyebrow">Acciones rápidas</p><h3>Gestión diaria</h3></div></div>
        <div className="quick-actions">
          <button onClick={() => goTo("clients")}><UserRoundPlus /><span><strong>Registrar clienta</strong><small>Crear y consultar fichas de clientas</small></span></button>
          <button onClick={() => goTo("stock")}><PackagePlus /><span><strong>Gestionar stock</strong><small>Productos, cantidades y movimientos</small></span></button>
        </div>
      </div>
    </section>
  );
}

function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState(emptyClient);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const data = await api<Client[]>(`/clients?search=${encodeURIComponent(search)}`);
    setClients(data);
  }

  useEffect(() => { load().catch(console.error); }, [search]);

  function startCreate() {
    setEditing(null);
    setForm(emptyClient);
    setError("");
    setOpen(true);
  }

  function startEdit(client: Client) {
    setEditing(client);
    setForm({
      name: client.name,
      phone: client.phone || "",
      email: client.email || "",
      birthday: client.birthday ? client.birthday.slice(0, 10) : "",
      allergies: client.allergies || "",
      notes: client.notes || ""
    });
    setError("");
    setOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");

    try {
      await api(editing ? `/clients/${editing.id}` : "/clients", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(form)
      });
      setOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    }
  }

  async function remove(client: Client) {
    if (!confirm(`¿Eliminar la ficha de ${client.name}?`)) return;
    await api(`/clients/${client.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <section className="page">
      <div className="toolbar">
        <div className="search-box"><Search size={18} /><input placeholder="Buscar por nombre, teléfono o correo" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <button className="primary-button fit" onClick={startCreate}><Plus size={18} />Nueva clienta</button>
      </div>

      <div className="content-card table-card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th>Alergias</th><th></th></tr></thead>
            <tbody>
              {clients.map(client => (
                <tr key={client.id}>
                  <td><strong>{client.name}</strong></td>
                  <td>{client.phone || "—"}</td>
                  <td>{client.email || "—"}</td>
                  <td>{client.allergies || "—"}</td>
                  <td className="actions">
                    <button className="icon-button" onClick={() => startEdit(client)}><Pencil size={17} /></button>
                    <button className="icon-button danger" onClick={() => remove(client)}><Trash2 size={17} /></button>
                  </td>
                </tr>
              ))}
              {!clients.length && <tr><td colSpan={5} className="empty">No hay clientas registradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <Modal title={editing ? "Editar clienta" : "Nueva clienta"} onClose={() => setOpen(false)}>
          <form onSubmit={save} className="form-grid">
            <label className="wide">Nombre<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
            <label>Teléfono<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
            <label>Correo<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
            <label>Fecha de nacimiento<input type="date" value={form.birthday} onChange={e => setForm({ ...form, birthday: e.target.value })} /></label>
            <label>Alergias<input value={form.allergies} onChange={e => setForm({ ...form, allergies: e.target.value })} /></label>
            <label className="wide">Notas<textarea rows={4} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
            {error && <div className="error-box wide">{error}</div>}
            <div className="modal-actions wide"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancelar</button><button className="primary-button fit">Guardar</button></div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function StockPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyProduct);
  const [open, setOpen] = useState(false);
  const [movementProduct, setMovementProduct] = useState<Product | null>(null);
  const [movement, setMovement] = useState({ type: "ENTRADA", quantity: 1, reason: "" });
  const [error, setError] = useState("");

  async function load() {
    setProducts(await api<Product[]>(`/products?search=${encodeURIComponent(search)}`));
  }

  useEffect(() => { load().catch(console.error); }, [search]);

  function startCreate() {
    setEditing(null);
    setForm(emptyProduct);
    setError("");
    setOpen(true);
  }

  function startEdit(product: Product) {
    setEditing(product);
    setForm({
      name: product.name,
      brand: product.brand || "",
      category: product.category || "",
      supplier: product.supplier || "",
      sku: product.sku || "",
      cost: Number(product.cost),
      price: Number(product.price),
      quantity: product.quantity,
      minimum: product.minimum,
      notes: product.notes || ""
    });
    setError("");
    setOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(editing ? `/products/${editing.id}` : "/products", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(form)
      });
      setOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    }
  }

  async function saveMovement(event: FormEvent) {
    event.preventDefault();
    if (!movementProduct) return;
    setError("");
    try {
      await api(`/products/${movementProduct.id}/movements`, {
        method: "POST",
        body: JSON.stringify(movement)
      });
      setMovementProduct(null);
      setMovement({ type: "ENTRADA", quantity: 1, reason: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el movimiento.");
    }
  }

  async function remove(product: Product) {
    if (!confirm(`¿Eliminar el producto ${product.name}?`)) return;
    await api(`/products/${product.id}`, { method: "DELETE" });
    await load();
  }

  const lowCount = useMemo(() => products.filter(p => p.quantity <= p.minimum).length, [products]);

  return (
    <section className="page">
      <div className="toolbar">
        <div className="search-box"><Search size={18} /><input placeholder="Buscar producto, marca, categoría o referencia" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <button className="primary-button fit" onClick={startCreate}><Plus size={18} />Nuevo producto</button>
      </div>

      {lowCount > 0 && <div className="notice">{lowCount} producto{lowCount === 1 ? "" : "s"} necesita{lowCount === 1 ? "" : "n"} reposición.</div>}

      <div className="product-grid">
        {products.map(product => {
          const low = product.quantity <= product.minimum;
          return (
            <article className={`product-card ${low ? "low" : ""}`} key={product.id}>
              <div className="product-card-head">
                <div><span>{product.category || "Sin categoría"}</span><h3>{product.name}</h3><small>{product.brand || "Sin marca"}{product.sku ? ` · ${product.sku}` : ""}</small></div>
                <div className="actions">
                  <button className="icon-button" onClick={() => startEdit(product)}><Pencil size={17} /></button>
                  <button className="icon-button danger" onClick={() => remove(product)}><Trash2 size={17} /></button>
                </div>
              </div>

              <div className="stock-number"><strong>{product.quantity}</strong><span>unidades</span></div>
              <div className="product-meta"><span>Mínimo: {product.minimum}</span><span>Venta: {Number(product.price).toFixed(2)} €</span></div>
              {low && <div className="low-label">Stock bajo</div>}
              <button className="secondary-button full" onClick={() => { setError(""); setMovementProduct(product); }}>Registrar movimiento</button>
            </article>
          );
        })}
        {!products.length && <div className="content-card empty">No hay productos registrados.</div>}
      </div>

      {open && (
        <Modal title={editing ? "Editar producto" : "Nuevo producto"} onClose={() => setOpen(false)}>
          <form onSubmit={save} className="form-grid">
            <label className="wide">Nombre<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
            <label>Marca<input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} /></label>
            <label>Categoría<input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></label>
            <label>Proveedor<input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} /></label>
            <label>Referencia / SKU<input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} /></label>
            <label>Coste<input type="number" min="0" step="0.01" value={form.cost} onChange={e => setForm({ ...form, cost: Number(e.target.value) })} /></label>
            <label>Precio de venta<input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} /></label>
            <label>Cantidad<input type="number" min="0" value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })} /></label>
            <label>Stock mínimo<input type="number" min="0" value={form.minimum} onChange={e => setForm({ ...form, minimum: Number(e.target.value) })} /></label>
            <label className="wide">Notas<textarea rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
            {error && <div className="error-box wide">{error}</div>}
            <div className="modal-actions wide"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancelar</button><button className="primary-button fit">Guardar</button></div>
          </form>
        </Modal>
      )}

      {movementProduct && (
        <Modal title={`Movimiento · ${movementProduct.name}`} onClose={() => setMovementProduct(null)}>
          <form onSubmit={saveMovement} className="form-stack">
            <label>Tipo<select value={movement.type} onChange={e => setMovement({ ...movement, type: e.target.value })}><option value="ENTRADA">Entrada</option><option value="SALIDA">Salida</option><option value="AJUSTE">Ajuste manual</option></select></label>
            <label>Cantidad<input type="number" value={movement.quantity} onChange={e => setMovement({ ...movement, quantity: Number(e.target.value) })} required /></label>
            <label>Motivo<textarea rows={3} value={movement.reason} onChange={e => setMovement({ ...movement, reason: e.target.value })} /></label>
            {error && <div className="error-box">{error}</div>}
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setMovementProduct(null)}>Cancelar</button><button className="primary-button fit">Registrar</button></div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-layer">
      <div className="modal-backdrop" onClick={onClose} />
      <section className="modal">
        <header><h3>{title}</h3><button className="icon-button" onClick={onClose}><X size={20} /></button></header>
        {children}
      </section>
    </div>
  );
}

export default App;
