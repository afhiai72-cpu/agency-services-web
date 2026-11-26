// ============================================================================
// KONFIGURASI SUPABASE & WEBHOOK N8N (GANTI SESUAI DATA KAMU)
// ============================================================================
const CONFIG = {
  SUPABASE_URL: "https://eqrxhlmlznwvqtfvqxkv.supabase.co",
  SUPABASE_PUBLISHABLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxcnhobG1sem53dnF0ZnZxeGt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2MjkzMjQsImV4cCI6MjExMTIwNTMyNH0.w6llBOlsnkhQjYPejJWLrJqeepw_TAoY8BqIK3pgvDQ",
  N8N_AI_CS_WEBHOOK_URL: "/api/ai-cs",
};

const state = {
  currency: "IDR",
  services: [],
  packages: [],
  addons: [],
  activeServiceId: null,
  selectedPackage: null,
  addonQuantities: {}, // { [addonId]: quantity }
  aiSessionId: "sess_" + Math.random().toString(36).slice(2, 12),
};

// ============================================================================
// FORMATTER MATA UANG
// ============================================================================
function formatMoney(amountIdr, amountUsd) {
  if (state.currency === "USD") {
    const val = Number(amountUsd ?? Math.round((amountIdr || 0) / 15500));
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(val);
  }
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(amountIdr || 0));
}

function getUnitPrice(item) {
  if (state.currency === "USD") {
    return Number(item.price_usd ?? Math.round((item.price_idr || 0) / 15500));
  }
  return Number(item.price_idr || 0);
}

// ============================================================================
// FETCH KATALOG DARI SUPABASE REST API
// ============================================================================
async function sbFetch(path, options = {}) {
  const url = `${CONFIG.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase error (${res.status}): ${errText}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function loadCatalog() {
  const banner = document.getElementById("statusBanner");
  try {
    const [services, packages, addons] = await Promise.all([
      sbFetch("services?is_active=eq.true&order=sort_order.asc"),
      sbFetch("packages?is_active=eq.true&order=sort_order.asc"),
      sbFetch("addons?is_active=eq.true&order=sort_order.asc"),
    ]);

    state.services = services || [];
    state.packages = packages || [];
    state.addons = addons || [];

    if (state.services.length > 0 && !state.activeServiceId) {
      state.activeServiceId = state.services[0].id;
    }

    banner.classList.add("hidden");
    renderTabs();
    renderPackages();
  } catch (err) {
    banner.textContent = `Gagal memuat katalog dari Supabase. Pastikan SUPABASE_PUBLISHABLE_KEY sudah diisi dan RLS aktif. Detail: ${err.message}`;
    banner.classList.remove("hidden");
  }
}

// ============================================================================
// RENDER TABS & KARTU PAKET
// ============================================================================
function renderTabs() {
  const tabsEl = document.getElementById("categoryTabs");
  tabsEl.innerHTML = "";

  state.services.forEach((srv) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `tab-btn ${srv.id === state.activeServiceId ? "active" : ""}`;
    btn.textContent = srv.name;
    btn.addEventListener("click", () => {
      state.activeServiceId = srv.id;
      renderTabs();
      renderPackages();
    });
    tabsEl.appendChild(btn);
  });
}

function renderPackages() {
  const grid = document.getElementById("packagesGrid");
  const filtered = state.packages.filter(
    (p) => p.service_id === state.activeServiceId,
  );

  if (filtered.length === 0) {
    grid.innerHTML = `<p class="pkg-audience">Belum ada paket aktif untuk kategori ini.</p>`;
    return;
  }

  grid.innerHTML = "";
  filtered.forEach((pkg) => {
    const deliverables = Array.isArray(pkg.deliverables)
      ? pkg.deliverables
      : [];
    const card = document.createElement("article");
    card.className = `pkg-card ${pkg.is_popular ? "popular" : ""}`;
    card.innerHTML = `
      <div>
        <div class="pkg-top">
          <span class="pkg-tier">${escapeHtml(pkg.tier_name)}</span>
          ${pkg.is_popular ? `<span class="badge-popular">Paling Populer</span>` : ""}
        </div>
        <h3>${escapeHtml(pkg.title)}</h3>
        <p class="pkg-audience">${escapeHtml(pkg.target_audience || "")}</p>
        <div class="pkg-price">${formatMoney(pkg.price_idr, pkg.price_usd)}</div>
        <p class="pkg-meta">Estimasi ${pkg.estimated_days} hari kerja • ${pkg.revision_quota}x revisi minor</p>
        <ul class="pkg-deliverables">
          ${deliverables.map((d) => `<li>${escapeHtml(String(d))}</li>`).join("")}
        </ul>
      </div>
      <button type="button" class="btn btn-primary btn-full select-pkg-btn" data-pkg-id="${pkg.id}">
        Pilih Paket Ini
      </button>
    `;

    card
      .querySelector(".select-pkg-btn")
      .addEventListener("click", () => openCheckout(pkg));
    grid.appendChild(card);
  });
}

// ============================================================================
// MODAL CHECKOUT & KALKULATOR ADD-ON
// ============================================================================
function openCheckout(pkg) {
  state.selectedPackage = pkg;
  state.addonQuantities = {};

  const service = state.services.find((s) => s.id === pkg.service_id);
  document.getElementById("checkoutCategoryLabel").textContent = service
    ? service.name
    : "Layanan";
  document.getElementById("checkoutTitle").textContent =
    `${pkg.tier_name} — ${pkg.title}`;
  document.getElementById("orderFeedback").classList.add("hidden");

  renderAddonsForPackage(pkg.service_id);
  recalculateSummary();

  const modal = document.getElementById("checkoutModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeCheckout() {
  const modal = document.getElementById("checkoutModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function renderAddonsForPackage(serviceId) {
  const listEl = document.getElementById("addonsList");
  const catAddons = state.addons.filter((a) => a.service_id === serviceId);

  if (catAddons.length === 0) {
    listEl.innerHTML = `<p class="pkg-audience">Tidak ada opsi add-on tambahan untuk kategori ini.</p>`;
    return;
  }

  listEl.innerHTML = "";
  catAddons.forEach((addon) => {
    const qty = state.addonQuantities[addon.id] || 0;
    const row = document.createElement("div");
    row.className = "addon-item";

    const priceText = formatMoney(addon.price_idr, addon.price_usd);
    const daysText =
      addon.extra_days_per_unit > 0
        ? ` • +${addon.extra_days_per_unit} hari`
        : "";

    let controlHtml = "";
    if (addon.input_type === "toggle") {
      controlHtml = `
        <input type="checkbox" class="addon-toggle" data-addon-id="${addon.id}" ${qty > 0 ? "checked" : ""} />
      `;
    } else {
      controlHtml = `
        <div class="qty-control">
          <button type="button" class="qty-btn qty-dec" data-addon-id="${addon.id}">-</button>
          <span class="qty-val" id="qty_${addon.id}">${qty}</span>
          <button type="button" class="qty-btn qty-inc" data-addon-id="${addon.id}">+</button>
        </div>
      `;
    }

    row.innerHTML = `
      <div class="addon-info">
        <strong>${escapeHtml(addon.name)}</strong>
        <span>${priceText} / ${escapeHtml(addon.unit_label)}${daysText}</span>
      </div>
      ${controlHtml}
    `;

    const toggleInput = row.querySelector(".addon-toggle");
    if (toggleInput) {
      toggleInput.addEventListener("change", (e) => {
        state.addonQuantities[addon.id] = e.target.checked ? 1 : 0;
        recalculateSummary();
      });
    }

    const decBtn = row.querySelector(".qty-dec");
    const incBtn = row.querySelector(".qty-inc");
    if (decBtn && incBtn) {
      decBtn.addEventListener("click", () => {
        const cur = state.addonQuantities[addon.id] || 0;
        if (cur > 0) {
          state.addonQuantities[addon.id] = cur - 1;
          document.getElementById(`qty_${addon.id}`).textContent =
            state.addonQuantities[addon.id];
          recalculateSummary();
        }
      });
      incBtn.addEventListener("click", () => {
        const cur = state.addonQuantities[addon.id] || 0;
        const maxQ = addon.max_quantity || 10;
        if (cur < maxQ) {
          state.addonQuantities[addon.id] = cur + 1;
          document.getElementById(`qty_${addon.id}`).textContent =
            state.addonQuantities[addon.id];
          recalculateSummary();
        }
      });
    }

    listEl.appendChild(row);
  });
}

function calculateTotals() {
  const pkg = state.selectedPackage;
  if (!pkg) {
    return {
      pkgPrice: 0,
      addonsTotal: 0,
      grandTotal: 0,
      totalDays: 0,
      selectedItems: [],
    };
  }

  const pkgPrice = getUnitPrice(pkg);
  let addonsTotal = 0;
  let extraDays = 0;
  const selectedItems = [];

  Object.entries(state.addonQuantities).forEach(([addonId, qty]) => {
    if (!qty || qty <= 0) return;
    const addon = state.addons.find((a) => a.id === addonId);
    if (!addon) return;

    const unitPrice = getUnitPrice(addon);
    const subtotal = unitPrice * qty;
    const daysAdded = (addon.extra_days_per_unit || 0) * qty;

    addonsTotal += subtotal;
    extraDays += daysAdded;
    selectedItems.push({
      addon,
      qty,
      unitPrice,
      subtotal,
      daysAdded,
    });
  });

  return {
    pkgPrice,
    addonsTotal,
    grandTotal: pkgPrice + addonsTotal,
    totalDays: Number(pkg.estimated_days || 0) + extraDays,
    selectedItems,
  };
}

function recalculateSummary() {
  const pkg = state.selectedPackage;
  if (!pkg) return;

  const { pkgPrice, grandTotal, totalDays, selectedItems } = calculateTotals();
  const currCode = state.currency;

  const fmt = (num) =>
    new Intl.NumberFormat(currCode === "USD" ? "en-US" : "id-ID", {
      style: "currency",
      currency: currCode,
      maximumFractionDigits: 0,
    }).format(num);

  document.getElementById("summaryPackageName").textContent =
    `${pkg.tier_name} (${pkg.title})`;
  document.getElementById("summaryPackagePrice").textContent = fmt(pkgPrice);

  const addonsBox = document.getElementById("summaryAddonsContainer");
  if (selectedItems.length === 0) {
    addonsBox.innerHTML = `<span>Tanpa add-on tambahan</span>`;
  } else {
    addonsBox.innerHTML = selectedItems
      .map(
        (item) =>
          `<div class="summary-row"><span>${escapeHtml(item.addon.name)} x${item.qty}</span><span>${fmt(item.subtotal)}</span></div>`,
      )
      .join("");
  }

  document.getElementById("summaryDays").textContent =
    `${totalDays} hari kerja`;
  document.getElementById("summaryGrandTotal").textContent = fmt(grandTotal);
}

// ============================================================================
// SIMPAN PESANAN KE SUPABASE (ORDERS + ORDER_ADDONS)
// ============================================================================
document.getElementById("orderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pkg = state.selectedPackage;
  if (!pkg) return;

  const submitBtn = document.getElementById("submitOrderBtn");
  const feedback = document.getElementById("orderFeedback");
  submitBtn.disabled = true;
  submitBtn.textContent = "Menyimpan pesanan...";
  feedback.classList.add("hidden");

  try {
    const { pkgPrice, addonsTotal, grandTotal, totalDays, selectedItems } =
      calculateTotals();
    const orderCode = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`;

    const payload = {
      order_code: orderCode,
      package_id: pkg.id,
      client_name: document.getElementById("clientName").value.trim(),
      client_email: document.getElementById("clientEmail").value.trim(),
      client_phone: document.getElementById("clientPhone").value.trim(),
      client_company:
        document.getElementById("clientCompany").value.trim() || null,
      project_brief:
        document.getElementById("projectBrief").value.trim() || null,
      currency: state.currency,
      package_price_amount: Math.round(pkgPrice),
      addons_total_amount: Math.round(addonsTotal),
      grand_total_amount: Math.round(grandTotal),
      estimated_total_days: totalDays,
      status: "pending_payment",
    };

    const createdOrders = await sbFetch("orders", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });

    const createdOrder = Array.isArray(createdOrders)
      ? createdOrders[0]
      : createdOrders;

    if (createdOrder && selectedItems.length > 0) {
      const orderAddonsPayload = selectedItems.map((item) => ({
        order_id: createdOrder.id,
        addon_id: item.addon.id,
        addon_name_snapshot: item.addon.name,
        unit_price_amount: Math.round(item.unitPrice),
        quantity: item.qty,
        subtotal_amount: Math.round(item.subtotal),
        extra_days_snapshot: item.daysAdded,
      }));

      await sbFetch("order_addons", {
        method: "POST",
        body: JSON.stringify(orderAddonsPayload),
      });
    }

    feedback.className = "order-feedback success";
    feedback.innerHTML = `Pesanan berhasil dicatat dengan kode <strong>${escapeHtml(orderCode)}</strong>. Tahap pembayaran otomatis akan terhubung setelah webhook payment gateway & n8n diaktifkan.`;
    feedback.classList.remove("hidden");
    document.getElementById("orderForm").reset();
  } catch (err) {
    feedback.className = "order-feedback error";
    feedback.textContent = `Gagal menyimpan pesanan: ${err.message}`;
    feedback.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Buat Pesanan Sekarang";
  }
});

// ============================================================================
// WIDGET AI CUSTOMER SERVICE (TERHUBUNG KE WEBHOOK N8N)
// ============================================================================
function toggleAiWidget(forceOpen = null) {
  const panel = document.getElementById("aiWidgetPanel");
  const isHidden = panel.classList.contains("hidden");
  const shouldOpen = forceOpen !== null ? forceOpen : isHidden;
  panel.classList.toggle("hidden", !shouldOpen);
}

function appendAiMessage(text, sender = "bot") {
  const box = document.getElementById("aiMessages");
  const div = document.createElement("div");
  div.className = `ai-msg ${sender}`;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function sendAiQuestion(question) {
  const cleanQ = question.trim();
  if (!cleanQ) return;

  appendAiMessage(cleanQ, "user");

  if (!CONFIG.N8N_AI_CS_WEBHOOK_URL) {
    appendAiMessage(
      "Widget AI CS siap dihubungkan ke webhook n8n di VPS Sumopod. Setelah Workflow AI Agent di n8n aktif, masukkan URL webhook-nya ke N8N_AI_CS_WEBHOOK_URL di file app.js.",
      "bot",
    );
    return;
  }

  const thinkingEl = document.createElement("div");
  thinkingEl.className = "ai-msg bot";
  thinkingEl.textContent = "Menyiapkan jawaban...";
  document.getElementById("aiMessages").appendChild(thinkingEl);

  try {
    const res = await fetch(CONFIG.N8N_AI_CS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: state.aiSessionId,
        message: cleanQ,
        currency: state.currency,
      }),
    });

    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 160)}`);
    }

    let data = {};
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { reply: rawText };
      }
    }

    const payload = Array.isArray(data) ? data[0] || {} : data;
    const replyText =
      payload.reply || payload.output || payload.text || payload.message || "";

    thinkingEl.remove();
    appendAiMessage(
      replyText ||
        "Maaf, saya belum dapat memproses pertanyaan tersebut saat ini.",
      "bot",
    );
  } catch (err) {
    console.error("AI CS Webhook Error:", err);
    thinkingEl.remove();
    appendAiMessage(
      "Terjadi gangguan koneksi ke layanan AI. Silakan coba lagi beberapa saat.",
      "bot",
    );
  }
}

// ============================================================================
// EVENT LISTENERS & INISIALISASI
// ============================================================================
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

document.querySelectorAll(".curr-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.currency = btn.dataset.curr;
    document
      .querySelectorAll(".curr-btn")
      .forEach((b) => b.classList.toggle("active", b === btn));
    renderPackages();
    if (state.selectedPackage) {
      renderAddonsForPackage(state.selectedPackage.service_id);
      recalculateSummary();
    }
  });
});

document
  .getElementById("closeCheckoutBtn")
  .addEventListener("click", closeCheckout);
document.getElementById("checkoutModal").addEventListener("click", (e) => {
  if (e.target.id === "checkoutModal") closeCheckout();
});

document
  .getElementById("openAiCsBtn")
  .addEventListener("click", () => toggleAiWidget(true));
document
  .getElementById("heroAiCsBtn")
  .addEventListener("click", () => toggleAiWidget(true));
document
  .getElementById("aiWidgetFab")
  .addEventListener("click", () => toggleAiWidget());
document
  .getElementById("closeAiWidgetBtn")
  .addEventListener("click", () => toggleAiWidget(false));

document.querySelectorAll(".quick-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    toggleAiWidget(true);
    sendAiQuestion(chip.dataset.q);
  });
});

document.getElementById("aiChatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("aiChatInput");
  const q = input.value;
  input.value = "";
  sendAiQuestion(q);
});

document.getElementById("yearSpan").textContent = new Date().getFullYear();
loadCatalog();
