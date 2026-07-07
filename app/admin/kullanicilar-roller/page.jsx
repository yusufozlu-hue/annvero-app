"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCompanyList } from "@/app/muhasebe/hooks/useCompanyList";
import { ANNVERO_ROLE_LABELS, ANNVERO_ROLES } from "@/src/config/annveroRoles";
import { ANNVERO_MODULES, ANNVERO_PERMISSIONS, getModulesForRole } from "@/src/lib/auth/permissions";
import { useUserRole } from "@/src/hooks/useUserRole";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-gray-950/80 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500/60";

const MODULE_LABELS = {
  [ANNVERO_MODULES.DASHBOARD]: "Dashboard",
  [ANNVERO_MODULES.MUHASEBE]: "Muhasebe",
  [ANNVERO_MODULES.BANKA_PARSER]: "Banka Parser",
  [ANNVERO_MODULES.FIS_KONTROL]: "Fiş Kontrol",
  [ANNVERO_MODULES.BEYANNAME]: "Beyanname",
  [ANNVERO_MODULES.E_DEFTER]: "E-Defter",
  [ANNVERO_MODULES.RISK]: "Risk",
  [ANNVERO_MODULES.IK]: "İK",
  [ANNVERO_MODULES.EVRAK]: "Evrak",
  [ANNVERO_MODULES.OTOMASYON]: "Otomasyon",
  [ANNVERO_MODULES.SISTEM]: "Sistem",
  [ANNVERO_MODULES.ADMIN]: "Admin",
};

function emptyForm() {
  return {
    email: "",
    displayName: "",
    role: "muhasebe_personeli",
    companyIds: [],
    permissions: ["view", "edit", "export"],
    teamId: "",
    isActive: true,
    invite: true,
  };
}

function isPendingUser(user = {}) {
  return !user.id || String(user.id).startsWith("pending-");
}

export default function KullanicilarRollerPage() {
  const { isManagementUser, isPartner, isPlatformAdmin, loading: roleLoading } = useUserRole();
  const canManageUsers = isManagementUser;
  const { companies, allCompanies } = useCompanyList();

  const [users, setUsers] = useState([]);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingEmail, setEditingEmail] = useState("");
  const [toast, setToast] = useState("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store", credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kullanıcılar yüklenemedi.");
      setUsers(data.users || []);
      setSchemaMissing(Boolean(data.schemaMissing));
    } catch (error) {
      setToast(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!roleLoading && canManageUsers) loadUsers();
  }, [canManageUsers, roleLoading, loadUsers]);

  const roleOptions = useMemo(() => {
    const entries = Object.entries(ANNVERO_ROLE_LABELS);
    if (isPlatformAdmin) {
      return entries.map(([id, label]) => ({ id, label }));
    }
    if (isPartner) {
      return entries
        .filter(([id]) => id !== ANNVERO_ROLES.ADMIN)
        .map(([id, label]) => ({ id, label }));
    }
    return entries.map(([id, label]) => ({ id, label }));
  }, [isPlatformAdmin, isPartner]);

  const saveUser = async () => {
    try {
      const payload = editingEmail ? { ...form, invite: false } : form;
      const response = await fetch("/api/admin/users", {
        method: editingEmail ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kayıt başarısız.");

      if (!editingEmail && data.invited) {
        setToast(`Kullanıcı oluşturuldu ve davet e-postası gönderildi.`);
      } else if (!editingEmail && form.invite && data.inviteError) {
        setToast(`Profil kaydedildi; davet gönderilemedi: ${data.inviteError}`);
      } else {
        setToast(editingEmail ? "Kullanıcı güncellendi." : "Kullanıcı oluşturuldu.");
      }

      setForm(emptyForm());
      setEditingEmail("");
      await loadUsers();
    } catch (error) {
      setToast(error.message);
    }
  };

  const resendInvite = async (user) => {
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...user,
          invite: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Davet gönderilemedi.");
      if (data.inviteError) throw new Error(data.inviteError);
      setToast(`${user.email} için davet yeniden gönderildi.`);
      await loadUsers();
    } catch (error) {
      setToast(error.message);
    }
  };

  const editUser = (user) => {
    setEditingEmail(user.email);
    setForm({
      email: user.email,
      displayName: user.displayName || "",
      role: user.role,
      companyIds: user.companyIds || [],
      permissions: user.permissions || [],
      teamId: user.teamId || "",
      isActive: user.isActive !== false,
    });
  };

  const requestPasswordReset = async (user) => {
    try {
      const response = await fetch("/api/admin/users", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...user, requestPasswordReset: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "İşlem başarısız.");
      if (data.recoverySent) {
        setToast(`${user.email} için şifre sıfırlama bağlantısı gönderildi.`);
      } else if (data.recoveryError) {
        setToast(`Şifre sıfırlama başarısız: ${data.recoveryError}`);
      } else {
        setToast(`${user.email} için şifre sıfırlama işaretlendi.`);
      }
      await loadUsers();
    } catch (error) {
      setToast(error.message);
    }
  };

  const toggleCompany = (companyId) => {
    setForm((prev) => ({
      ...prev,
      companyIds: prev.companyIds.includes(companyId)
        ? prev.companyIds.filter((id) => id !== companyId)
        : [...prev.companyIds, companyId],
    }));
  };

  if (roleLoading) {
    return <div className="p-8 text-slate-400">Yetki kontrolü...</div>;
  }

  if (!canManageUsers) {
    return (
      <div className="rounded-2xl border border-red-900/40 bg-red-950/20 p-8 text-center">
        <h1 className="text-xl font-bold text-red-100">Yetkisiz erişim</h1>
        <p className="mt-2 text-sm text-red-200/80">Bu ekran yalnızca admin ve partner kullanıcılar içindir.</p>
      </div>
    );
  }

  return (
    <main className="space-y-6 text-white">
      {toast ? (
        <div className="fixed right-4 top-4 z-50 rounded-xl border border-cyan-500/40 bg-cyan-950/90 px-4 py-3 text-sm">
          {toast}
        </div>
      ) : null}

      <div>
        <h1 className="text-3xl font-bold">Kullanıcılar & Roller</h1>
        <p className="mt-2 text-sm text-slate-400">
          Kullanıcı oluşturma, rol atama, firma erişimi ve modül yetkileri.
        </p>
      </div>

      {schemaMissing ? (
        <div className="rounded-2xl border border-amber-700/40 bg-amber-950/20 p-4 text-sm text-amber-100">
          Supabase kullanıcı tablosu henüz yok. Migration dosyasını çalıştırın:{" "}
          <code>supabase/migrations/011_annvero_user_profiles.sql</code>
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="mb-4 text-lg font-semibold">{editingEmail ? "Kullanıcı Düzenle" : "Yeni Kullanıcı"}</h2>
          <div className="space-y-3">
            <input
              className={inputClass}
              placeholder="E-posta"
              value={form.email}
              disabled={Boolean(editingEmail)}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <input
              className={inputClass}
              placeholder="Ad Soyad"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
            <select
              className={inputClass}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {roleOptions.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              placeholder="Ekip ID (opsiyonel)"
              value={form.teamId}
              onChange={(e) => setForm({ ...form, teamId: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Aktif kullanıcı
            </label>

            {!editingEmail ? (
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.invite}
                  onChange={(e) => setForm({ ...form, invite: e.target.checked })}
                />
                Supabase davet e-postası gönder
              </label>
            ) : null}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Firma erişimi</p>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-800 p-2">
                {(allCompanies || companies).map((company) => (
                  <label key={company.id} className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.companyIds.includes(company.id)}
                      onChange={() => toggleCompany(company.id)}
                    />
                    {company.company_name || company.name || company.id}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Admin/partner dışı rollerde boş bırakılırsa firma erişimi olmaz.
              </p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Modül yetkileri</p>
              <div className="flex flex-wrap gap-2">
                {Object.values(ANNVERO_PERMISSIONS).map((permission) => (
                  <label key={permission} className="rounded-lg border border-slate-700 px-2 py-1 text-xs">
                    <input
                      type="checkbox"
                      className="mr-1"
                      checked={form.permissions.includes(permission)}
                      onChange={() =>
                        setForm((prev) => ({
                          ...prev,
                          permissions: prev.permissions.includes(permission)
                            ? prev.permissions.filter((item) => item !== permission)
                            : [...prev.permissions, permission],
                        }))
                      }
                    />
                    {permission}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveUser}
                className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold hover:bg-cyan-500"
              >
                {editingEmail ? "Güncelle" : "Oluştur"}
              </button>
              {editingEmail ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingEmail("");
                    setForm(emptyForm());
                  }}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-sm"
                >
                  İptal
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Kullanıcı Listesi</h2>
            <button type="button" onClick={loadUsers} className="text-xs text-cyan-300">
              Yenile
            </button>
          </div>
          {loading ? (
            <p className="text-sm text-slate-400">Yükleniyor...</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-slate-400">Kayıtlı kullanıcı yok.</p>
          ) : (
            <div className="space-y-2">
              {users.map((user) => (
                <article key={user.email} className="rounded-xl border border-slate-800 p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{user.displayName || user.email}</p>
                      <p className="text-xs text-slate-400">{user.email}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {ANNVERO_ROLE_LABELS[user.role] || user.role} ·{" "}
                        {user.isActive === false ? "Pasif" : "Aktif"} ·{" "}
                        {isPendingUser(user) ? "Davet bekliyor" : "Kayıtlı"} · Son giriş:{" "}
                        {user.lastLoginAt?.slice(0, 16).replace("T", " ") || "—"}
                      </p>
                      <p className="text-xs text-slate-500">
                        Firmalar:{" "}
                        {user.role === ANNVERO_ROLES.ADMIN || user.role === ANNVERO_ROLES.PARTNER
                          ? "Tümü"
                          : user.companyIds?.length || 0}{" "}
                        · Ekip: {user.teamId || "—"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => editUser(user)}
                        className="rounded-lg border border-slate-700 px-2 py-1 text-xs"
                      >
                        Düzenle
                      </button>
                      <button
                        type="button"
                        onClick={() => requestPasswordReset(user)}
                        className="rounded-lg border border-amber-700/50 px-2 py-1 text-xs text-amber-200"
                      >
                        Şifre sıfırla
                      </button>
                      {isPendingUser(user) ? (
                        <button
                          type="button"
                          onClick={() => resendInvite(user)}
                          className="rounded-lg border border-cyan-700/50 px-2 py-1 text-xs text-cyan-200"
                        >
                          Daveti yenile
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="mb-3 text-lg font-semibold">Rol → Modül Matrisi</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {roleOptions.map((role) => (
            <div key={role.id} className="rounded-xl border border-slate-800 p-3 text-xs text-slate-300">
              <p className="mb-1 font-semibold text-white">{role.label}</p>
              <p>
                {getModulesForRole(role.id)
                  .map((moduleId) => MODULE_LABELS[moduleId] || moduleId)
                  .join(", ")}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
