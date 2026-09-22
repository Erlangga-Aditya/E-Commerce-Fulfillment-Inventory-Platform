'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Package,
  Plus,
  Search,
  RefreshCw,
  Pencil,
  Trash2,
  Layers,
  Check,
  AlertCircle,
  X,
  ExternalLink,
} from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState, Alert, Modal } from '@/components/ui';

interface Variant {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  weight: number | null;
  imageUrl: string | null;
  status: string;
  stock?: {
    onHand: number;
    reserved: number;
    available: number;
  };
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  status: string;
  createdAt: string;
  variants: Variant[];
}

export default function ProdukPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [variantsModalProduct, setVariantsModalProduct] = useState<Product | null>(null);
  const [deleteProductTarget, setDeleteProductTarget] = useState<Product | null>(null);

  // Forms state
  const [createForm, setCreateForm] = useState({
    name: '',
    category: '',
    description: '',
    sku: '',
    variantName: 'Standar',
    weight: 200,
    barcode: '',
  });

  const [editForm, setEditForm] = useState({
    name: '',
    category: '',
    description: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
  });

  const [newVariantForm, setNewVariantForm] = useState({
    sku: '',
    name: '',
    barcode: '',
    weight: 200,
  });

  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (statusFilter !== 'ALL') q.set('status', statusFilter);
    if (search) q.set('search', search);

    api<{ items: Product[] }>(`/api/v1/catalog/products?${q.toString()}`)
      .then((d) => setProducts(d.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [statusFilter, search]);

  useEffect(load, [load]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.category && p.category.toLowerCase().includes(q)) ||
        p.variants.some(
          (v) =>
            v.sku.toLowerCase().includes(q) ||
            v.name.toLowerCase().includes(q) ||
            (v.barcode && v.barcode.toLowerCase().includes(q)),
        )
      );
    });
  }, [products, search, statusFilter]);

  async function handleCreateProduct(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    setSubmitting(true);
    try {
      await api('/api/v1/catalog/products', {
        method: 'POST',
        body: {
          name: createForm.name,
          category: createForm.category || undefined,
          description: createForm.description || undefined,
          variants: [
            {
              sku: createForm.sku.toUpperCase(),
              name: createForm.variantName,
              weight: Number(createForm.weight) || 100,
              barcode: createForm.barcode || undefined,
            },
          ],
        },
      });
      setNotice({ tone: 'success', text: `Produk "${createForm.name}" berhasil dibuat.` });
      setCreateModalOpen(false);
      setCreateForm({
        name: '',
        category: '',
        description: '',
        sku: '',
        variantName: 'Standar',
        weight: 200,
        barcode: '',
      });
      load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!editProduct) return;
    setNotice(null);
    setSubmitting(true);
    try {
      await api(`/api/v1/catalog/products/${editProduct.id}`, {
        method: 'PATCH',
        body: editForm,
      });
      setNotice({ tone: 'success', text: `Produk "${editForm.name}" berhasil diperbarui.` });
      setEditProduct(null);
      load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteProduct() {
    if (!deleteProductTarget) return;
    setNotice(null);
    setSubmitting(true);
    try {
      await api(`/api/v1/catalog/products/${deleteProductTarget.id}`, {
        method: 'DELETE',
      });
      setNotice({
        tone: 'success',
        text: `Produk "${deleteProductTarget.name}" berhasil diarsipkan (dihapus).`,
      });
      setDeleteProductTarget(null);
      load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddVariant(e: React.FormEvent) {
    e.preventDefault();
    if (!variantsModalProduct) return;
    setNotice(null);
    setSubmitting(true);
    try {
      await api(`/api/v1/catalog/products/${variantsModalProduct.id}/variants`, {
        method: 'POST',
        body: {
          sku: newVariantForm.sku.toUpperCase(),
          name: newVariantForm.name,
          weight: Number(newVariantForm.weight) || 100,
          barcode: newVariantForm.barcode || undefined,
        },
      });
      setNotice({
        tone: 'success',
        text: `Varian SKU ${newVariantForm.sku} berhasil ditambahkan.`,
      });
      setNewVariantForm({ sku: '', name: '', barcode: '', weight: 200 });
      // Refresh single product
      const updated = await api<Product>(`/api/v1/catalog/products/${variantsModalProduct.id}`);
      setVariantsModalProduct(updated);
      load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteVariant(variantId: string, sku: string) {
    if (!variantsModalProduct) return;
    if (!confirm(`Apakah Anda yakin ingin mengarsipkan varian ${sku}?`)) return;
    try {
      await api(`/api/v1/catalog/products/${variantsModalProduct.id}/variants/${variantId}`, {
        method: 'DELETE',
      });
      const updated = await api<Product>(`/api/v1/catalog/products/${variantsModalProduct.id}`);
      setVariantsModalProduct(updated);
      load();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Katalog Produk & Master SKU"
        subtitle="Kelola master produk, SKU varian, bobot timbangan, dan informasi barcode untuk sinkronisasi pesanan & stok"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setLoading(true);
                setError('');
                load();
              }}
            >
              <RefreshCw size={14} aria-hidden />
              <span>Muat Ulang</span>
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setCreateModalOpen(true)}
            >
              <Plus size={14} aria-hidden />
              <span>Tambah Produk Baru</span>
            </button>
          </div>
        }
      />

      {notice && (
        <div className="mb16">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      {/* Filter & Search */}
      <div className="card mb20" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <div className="search-input-wrapper" style={{ flex: 1, minWidth: 260 }}>
            <Search size={16} aria-hidden />
            <input
              type="text"
              className="search-input"
              placeholder="Cari nama produk, SKU varian, kategori, barcode..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { label: 'Aktif (Katalog)', value: 'ALL' },
            { label: 'Hanya ACTIVE', value: 'ACTIVE' },
            { label: 'Hanya INACTIVE', value: 'INACTIVE' },
            { label: 'Diarsipkan (ARCHIVED)', value: 'ARCHIVED' },
          ].map((f) => (
            <button
              key={f.value}
              type="button"
              className={`btn btn-sm ${statusFilter === f.value ? 'btn-primary' : 'btn-secondary'}`}
              style={{ borderRadius: 20, fontSize: 12, padding: '4px 12px' }}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingState message="Memuat daftar katalog produk..." />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            setError('');
            load();
          }}
        />
      ) : filteredProducts.length === 0 ? (
        <EmptyState
          title={search ? 'Produk tidak ditemukan' : 'Belum ada katalog produk'}
          description={
            search
              ? `Tidak ditemukan produk yang cocok dengan "${search}".`
              : 'Produk akan otomatis terisi saat dilakukan sinkronisasi toko Shopee, atau Anda dapat menambahkan produk manual.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Produk</th>
                <th>Kategori</th>
                <th>Varian & SKU Utama</th>
                <th>Total Stok Fisik</th>
                <th>Status</th>
                <th>Tanggal Buat</th>
                <th style={{ textAlign: 'center' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p) => {
                const totalStock = p.variants.reduce((acc, v) => acc + (v.stock?.onHand ?? 0), 0);
                const totalAvailable = p.variants.reduce((acc, v) => acc + (v.stock?.available ?? 0), 0);

                return (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Package size={18} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                          {p.description && (
                            <div className="small muted" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-neutral">{p.category ?? 'Umum'}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="mono" style={{ fontWeight: 600, fontSize: 12 }}>
                            {p.variants[0]?.sku ?? '—'}
                          </span>
                          {p.variants.length > 1 && (
                            <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                              +{p.variants.length - 1} varian
                            </span>
                          )}
                        </div>
                        <div className="small muted">{p.variants[0]?.name}</div>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{totalStock} pcs</div>
                      <div className="small muted">Tersedia: {totalAvailable} pcs</div>
                    </td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="small muted">{formatDate(p.createdAt)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setVariantsModalProduct(p)}
                          title="Kelola Varian & SKU"
                        >
                          <Layers size={13} />
                          <span>Varian ({p.variants.length})</span>
                        </button>

                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setEditProduct(p);
                            setEditForm({
                              name: p.name,
                              category: p.category ?? '',
                              description: p.description ?? '',
                              status: p.status as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
                            });
                          }}
                          title="Edit Produk"
                        >
                          <Pencil size={13} />
                          <span>Edit</span>
                        </button>

                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => setDeleteProductTarget(p)}
                          title="Hapus / Arsipkan Produk"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Tambah Produk Baru */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Tambah Produk & SKU Baru"
      >
        <form onSubmit={handleCreateProduct}>
          <div className="field">
            <label>Nama Produk *</label>
            <input
              type="text"
              className="input"
              required
              placeholder="Contoh: Kemeja Formal Pria Lengan Panjang"
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Kategori (Opsional)</label>
            <input
              type="text"
              className="input"
              placeholder="Contoh: Pakaian Pria / Aksesoris"
              value={createForm.category}
              onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Deskripsi Produk (Opsional)</label>
            <textarea
              className="input"
              rows={2}
              placeholder="Keterangan singkat produk..."
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
            />
          </div>

          <div style={{ background: 'var(--subtle)', padding: 14, borderRadius: 8, marginTop: 14, marginBottom: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Layers size={14} style={{ color: 'var(--primary)' }} />
              Varian Awal (Default SKU)
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Kode SKU *</label>
                <input
                  type="text"
                  className="input mono"
                  required
                  placeholder="Contoh: KMJ-PUTIH-L"
                  value={createForm.sku}
                  onChange={(e) => setCreateForm({ ...createForm, sku: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label>Nama Varian *</label>
                <input
                  type="text"
                  className="input"
                  required
                  placeholder="Contoh: Putih - Ukuran L"
                  value={createForm.variantName}
                  onChange={(e) => setCreateForm({ ...createForm, variantName: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Berat (gram) *</label>
                <input
                  type="number"
                  className="input"
                  required
                  min={1}
                  value={createForm.weight}
                  onChange={(e) => setCreateForm({ ...createForm, weight: Number(e.target.value) })}
                />
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label>Barcode EAN/UPC (Opsional)</label>
                <input
                  type="text"
                  className="input mono"
                  placeholder="899..."
                  value={createForm.barcode}
                  onChange={(e) => setCreateForm({ ...createForm, barcode: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button type="submit" className="btn btn-primary grow" disabled={submitting || !createForm.name || !createForm.sku}>
              {submitting ? 'Menyimpan...' : 'Simpan Produk'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setCreateModalOpen(false)}>
              Batal
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Edit Produk */}
      <Modal
        isOpen={Boolean(editProduct)}
        onClose={() => setEditProduct(null)}
        title={`Edit Produk — ${editProduct?.name}`}
      >
        <form onSubmit={handleUpdateProduct}>
          <div className="field">
            <label>Nama Produk *</label>
            <input
              type="text"
              className="input"
              required
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Kategori</label>
            <input
              type="text"
              className="input"
              value={editForm.category}
              onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Status Produk</label>
            <select
              className="input"
              value={editForm.status}
              onChange={(e) => setEditForm({ ...editForm, status: e.target.value as any })}
            >
              <option value="ACTIVE">ACTIVE (Aktif)</option>
              <option value="INACTIVE">INACTIVE (Nonaktif)</option>
              <option value="ARCHIVED">ARCHIVED (Diarsipkan)</option>
            </select>
          </div>

          <div className="field">
            <label>Deskripsi</label>
            <textarea
              className="input"
              rows={3}
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button type="submit" className="btn btn-primary grow" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Perbarui Produk'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditProduct(null)}>
              Batal
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Kelola Varian */}
      <Modal
        isOpen={Boolean(variantsModalProduct)}
        onClose={() => setVariantsModalProduct(null)}
        title={`Kelola Varian — ${variantsModalProduct?.name}`}
      >
        <div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Daftar Varian Terdaftar:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {variantsModalProduct?.variants.map((v) => (
                <div
                  key={v.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: 'var(--subtle)',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>
                        {v.sku}
                      </span>
                      <StatusBadge status={v.status} />
                    </div>
                    <div className="small muted">
                      {v.name} {v.weight ? `• ${v.weight}g` : ''} {v.barcode ? `• Barcode: ${v.barcode}` : ''}
                    </div>
                  </div>

                  {variantsModalProduct.variants.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDeleteVariant(v.id, v.sku)}
                      title="Arsipkan Varian"
                      style={{ padding: '4px 8px' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Form Tambah Varian Baru */}
          <form
            onSubmit={handleAddVariant}
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 16,
              marginTop: 16,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} style={{ color: 'var(--primary)' }} />
              Tambah Varian Baru
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field">
                <label>SKU *</label>
                <input
                  type="text"
                  className="input mono"
                  required
                  placeholder="Contoh: KMJ-HITAM-XL"
                  value={newVariantForm.sku}
                  onChange={(e) => setNewVariantForm({ ...newVariantForm, sku: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="field">
                <label>Nama Varian *</label>
                <input
                  type="text"
                  className="input"
                  required
                  placeholder="Contoh: Hitam - XL"
                  value={newVariantForm.name}
                  onChange={(e) => setNewVariantForm({ ...newVariantForm, name: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field">
                <label>Berat (gram) *</label>
                <input
                  type="number"
                  className="input"
                  required
                  min={1}
                  value={newVariantForm.weight}
                  onChange={(e) => setNewVariantForm({ ...newVariantForm, weight: Number(e.target.value) })}
                />
              </div>

              <div className="field">
                <label>Barcode (Opsional)</label>
                <input
                  type="text"
                  className="input mono"
                  placeholder="899..."
                  value={newVariantForm.barcode}
                  onChange={(e) => setNewVariantForm({ ...newVariantForm, barcode: e.target.value })}
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 8 }}
              disabled={submitting || !newVariantForm.sku || !newVariantForm.name}
            >
              {submitting ? 'Menambahkan...' : 'Tambah Varian'}
            </button>
          </form>
        </div>
      </Modal>

      {/* Modal Konfirmasi Hapus / Arsip Produk */}
      <Modal
        isOpen={Boolean(deleteProductTarget)}
        onClose={() => setDeleteProductTarget(null)}
        title="Konfirmasi Hapus Produk"
      >
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <AlertCircle size={48} style={{ color: 'var(--danger)', margin: '0 auto 16px' }} />
          <h4 style={{ marginBottom: 8 }}>Arsipkan Produk {deleteProductTarget?.name}?</h4>
          <p className="muted small" style={{ marginBottom: 20 }}>
            Produk dan seluruh SKU variannya akan diarsipkan (soft-deleted). Produk tidak akan lagi muncul di katalog aktif, namun riwayat pesanan dan audit log masa lalu tetap aman terjaga.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              type="button"
              className="btn btn-danger"
              disabled={submitting}
              onClick={handleDeleteProduct}
            >
              {submitting ? 'Menghapus...' : 'Ya, Arsipkan Produk'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDeleteProductTarget(null)}
            >
              Batal
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
