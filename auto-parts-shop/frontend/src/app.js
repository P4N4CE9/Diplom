// ============================================
// Бэкенд: в режиме разработки Vite проксирует запросы к серверу и статику загрузок; в продакшене используются относительные пути.
// ============================================
const BACKEND_BASE = import.meta.env.VITE_API_BASE || '/api';
const MEDIA_ORIGIN = import.meta.env.VITE_MEDIA_ORIGIN ?? '';

function mediaUrl(path) {
    if (!path) return null;
    if (path.startsWith('http') || path.startsWith('data:')) return path;
    return `${MEDIA_ORIGIN}${path}`;
}

const AUTH_TOKEN_KEY = 'accessToken';
let accessToken = localStorage.getItem(AUTH_TOKEN_KEY) || localStorage.getItem('adminToken') || null;
if (localStorage.getItem('adminToken') && !localStorage.getItem(AUTH_TOKEN_KEY)) {
    localStorage.setItem(AUTH_TOKEN_KEY, localStorage.getItem('adminToken'));
}
let authUser = null;
try {
    authUser = JSON.parse(localStorage.getItem('authUser') || 'null');
} catch {
    authUser = null;
}

function saveAuth(token, user) {
    accessToken = token;
    authUser = user;
    if (token) {
        localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
        localStorage.removeItem(AUTH_TOKEN_KEY);
    }
    localStorage.removeItem('adminToken');
    if (user) {
        localStorage.setItem('authUser', JSON.stringify(user));
    } else {
        localStorage.removeItem('authUser');
    }
    updateAuthUI();
}

function clearAuth() {
    saveAuth(null, null);
}

function updateAuthUI() {
    const panel = document.getElementById('adminPanel');
    const profileBtn = document.getElementById('headerProfileBtn');
    if (panel) {
        panel.classList.toggle('hidden', !(authUser && accessToken && authUser.is_admin));
    }
    if (profileBtn) {
        const loggedIn = Boolean(authUser && accessToken);
        profileBtn.setAttribute('aria-label', loggedIn ? 'Аккаунт' : 'Вход или регистрация');
        profileBtn.title = loggedIn ? (authUser.email || 'Аккаунт') : 'Вход или регистрация';
    }
}

function handleProfileClick() {
    if (!authUser || !accessToken) {
        openAuthModal('login');
        return;
    }
    openAccountModal();
}

async function openAccountModal() {
    const m = document.getElementById('accountModal');
    const nameEl = document.getElementById('accountNameDisplay');
    const emailEl = document.getElementById('accountEmailDisplay');
    const hint = document.getElementById('accountAdminHint');
    if (nameEl) nameEl.textContent = authUser?.full_name || 'Покупатель';
    if (emailEl) emailEl.textContent = authUser?.email || '—';
    if (hint) hint.classList.toggle('hidden', !authUser?.is_admin);
    updateAccountAvatar();
    if (m) {
        m.classList.add('active');
        lockPageScroll();
    }

    renderAccountOrdersLoading();

    try {
        const history = await fetchJson('/orders/my');
        renderAccountOrders(history);
    } catch (error) {
        console.error('Ошибка загрузки истории заказов:', error);
        renderAccountOrdersError(error.message || 'Не удалось загрузить историю заказов');
    }
}

function closeAccountModal() {
    const m = document.getElementById('accountModal');
    if (m) m.classList.remove('active');
    unlockPageScroll();
}

async function refreshSession() {
    if (!accessToken) {
        authUser = null;
        updateAuthUI();
        return;
    }
    try {
        const res = await fetch(`${BACKEND_BASE}/auth/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error('unauthorized');
        authUser = await res.json();
        localStorage.setItem('authUser', JSON.stringify(authUser));
    } catch {
        clearAuth();
    }
    updateAuthUI();
}

// ============================================
// Запросы к серверу
// ============================================

/** JSON-запрос к бэкенду с авторизацией по Bearer-токену */
async function fetchJson(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
        const response = await fetch(`${BACKEND_BASE}${url}`, {
            ...options,
            headers
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
            throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Ошибка запроса:', error);
        throw error;
    }
}

// ============================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================
let products = [];
let cart = [];
let currentFilter = 'all';
let orders = [];
const CATEGORY_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

const ORDER_STATUS_META = {
    'новый': { label: 'Новый', color: '#3b82f6' },
    'в обработке': { label: 'В обработке', color: '#f59e0b' },
    'отправлен': { label: 'Отправлен', color: '#8b5cf6' },
    'доставлен': { label: 'Доставлен', color: '#10b981' },
    'отменен': { label: 'Отменен', color: '#ef4444' },
};

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function formatMoney(value) {
    const amount = Number(value ?? 0);
    if (Number.isNaN(amount)) {
        return `${value ?? 0} ₽`;
    }
    return `${new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(amount)} ₽`;
}

function formatDateTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('ru-RU');
}

function formatOrderDate(value) {
    if (!value) return 'неизвестной даты';
    return new Date(value).toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function lockPageScroll() {
    document.body.classList.add('modal-scroll-lock');
}

function unlockPageScroll() {
    document.body.classList.remove('modal-scroll-lock');
}

function getOrderStatusMeta(status) {
    const normalized = String(status || 'новый').trim().toLowerCase();
    return ORDER_STATUS_META[normalized] || {
        label: status || 'Новый',
        color: '#64748b',
    };
}

const ORDER_STATUS_CLASS = {
    'новый': 'new',
    'в обработке': 'processing',
    'отправлен': 'shipped',
    'доставлен': 'delivered',
    'отменен': 'cancelled',
};

function getOrderStatusClass(status) {
    const normalized = String(status || 'новый').trim().toLowerCase();
    return ORDER_STATUS_CLASS[normalized] || 'unknown';
}

function updateAccountAvatar() {
    const avatarEl = document.getElementById('accountAvatar');
    if (!avatarEl) return;
    const name = String(authUser?.full_name || 'Покупатель').trim();
    const initial = (name.charAt(0) || '?').toUpperCase();
    avatarEl.textContent = initial;
}

function updateAccountStats(history = []) {
    const countEl = document.getElementById('accountStatsOrders');
    const spentEl = document.getElementById('accountStatsSpent');
    const lastEl = document.getElementById('accountStatsLast');
    const summaryEl = document.getElementById('accountOrdersSummary');

    const totalSpent = history.reduce((sum, order) => sum + Number(order.общая_сумма || 0), 0);
    const latestOrderDate = history[0]?.дата_заказа ? formatDateTime(history[0].дата_заказа) : 'Пока нет';

    if (countEl) countEl.textContent = String(history.length);
    if (spentEl) spentEl.textContent = formatMoney(totalSpent);
    if (lastEl) lastEl.textContent = latestOrderDate;
    if (summaryEl) {
        summaryEl.textContent = history.length
            ? `${history.length} ${history.length === 1 ? 'заказ' : history.length < 5 ? 'заказа' : 'заказов'}`
            : 'Заказов пока нет';
    }
}

function renderAccountOrdersLoading() {
    updateAccountStats([]);
    const content = document.getElementById('accountOrdersContent');
    if (!content) return;
    content.innerHTML = `
        <div class="account-loading" aria-busy="true" aria-label="Загрузка заказов">
            ${[1, 2].map(() => `
                <div class="account-skeleton p-5">
                    <div class="account-skeleton-line mb-3 w-24"></div>
                    <div class="account-skeleton-line mb-2 w-40"></div>
                    <div class="account-skeleton-line w-56"></div>
                </div>
            `).join('')}
            <p class="text-center text-sm text-muted">Загружаем историю заказов...</p>
        </div>
    `;
}

function renderAccountOrdersError(message) {
    updateAccountStats([]);
    const content = document.getElementById('accountOrdersContent');
    if (!content) return;
    content.innerHTML = `
        <div class="rounded-xl border border-error/30 bg-error/10 p-5 text-sm text-error">
            <p class="font-bold">Не удалось загрузить историю заказов</p>
            <p class="mt-2">${escapeHtml(message)}</p>
            <button type="button" class="admin-btn mt-4" onclick="openAccountModal()">Повторить</button>
        </div>
    `;
}

function renderAccountOrders(history = []) {
    updateAccountStats(history);
    const content = document.getElementById('accountOrdersContent');
    if (!content) return;

    if (history.length === 0) {
        content.innerHTML = `
            <div class="account-empty">
                <div class="account-empty-icon" aria-hidden="true">📭</div>
                <p class="text-base font-bold uppercase tracking-wide text-ink">История заказов пока пуста</p>
                <p class="mt-2 max-w-sm text-sm leading-relaxed text-muted">Оформите первый заказ в каталоге — он сразу появится здесь со статусом и составом.</p>
                <button type="button" class="btn-primary mt-6" onclick="closeAccountModal()">Перейти в каталог</button>
            </div>
        `;
        return;
    }

    content.innerHTML = `
        <div class="account-orders-list">
            ${history.map(order => {
                const statusMeta = getOrderStatusMeta(order.статус);
                const statusClass = getOrderStatusClass(order.статус);
                const positions = Array.isArray(order.позиции) ? order.позиции : [];
                const totalItems = positions.reduce((sum, item) => sum + Number(item.количество || 0), 0);

                return `
                    <article class="account-order-card account-order-card--${statusClass}">
                        <div class="account-order-head">
                            <div>
                                <h3 class="account-order-title">Заказ от ${escapeHtml(formatOrderDate(order.дата_заказа))}</h3>
                            </div>
                            <div class="account-order-aside">
                                <span class="status-badge status-badge--${statusClass}">${escapeHtml(statusMeta.label)}</span>
                                <div class="text-left sm:text-right">
                                    <p class="account-order-total">${formatMoney(order.общая_сумма || 0)}</p>
                                    <p class="account-order-items-count">${totalItems} шт. · ${positions.length} ${positions.length === 1 ? 'позиция' : positions.length < 5 ? 'позиции' : 'позиций'}</p>
                                </div>
                            </div>
                        </div>
                        <div class="account-order-positions">
                            ${positions.length ? positions.map(position => `
                                <div class="account-order-position">
                                    <div class="min-w-0 flex-1">
                                        <p class="account-order-position-name">${escapeHtml(position.название || `Товар #${position.id_запчасти}`)}</p>
                                        <p class="account-order-position-sku">${escapeHtml(position.артикул || 'Без артикула')}</p>
                                    </div>
                                    <div class="account-order-position-meta">
                                        <span class="account-order-qty">${position.количество} шт.</span>
                                        <span class="account-order-position-price">${formatMoney(position.сумма || 0)}</span>
                                    </div>
                                </div>
                            `).join('') : `
                                <div class="account-order-position">
                                    <p class="text-sm text-muted">Состав заказа недоступен</p>
                                </div>
                            `}
                        </div>
                        <div class="account-order-footer">
                            <span class="account-order-chip">💳 ${escapeHtml(order.способ_оплаты || 'Не указана')}</span>
                            <span class="account-order-chip">📦 ${totalItems} шт.</span>
                        </div>
                    </article>
                `;
            }).join('')}
        </div>
    `;
}

function initCategoryCardImages() {
    document.querySelectorAll('[data-category-image]').forEach((img) => {
        if (img.dataset.initialized === 'true') return;
        img.dataset.initialized = 'true';

        const imageName = img.dataset.categoryImage;
        if (!imageName) return;

        let extensionIndex = 0;
        const tryNextImage = () => {
            if (extensionIndex >= CATEGORY_IMAGE_EXTENSIONS.length) {
                img.removeAttribute('src');
                img.classList.add('hidden');
                return;
            }

            const extension = CATEGORY_IMAGE_EXTENSIONS[extensionIndex];
            extensionIndex += 1;
            img.src = mediaUrl(`/uploads/images/categories/${imageName}.${extension}`);
        };

        img.onerror = tryNextImage;
        img.onload = () => img.classList.remove('hidden');
        tryNextImage();
    });
}

// ============================================
// ЗАГРУЗКА ДАННЫХ С СЕРВЕРА
// ============================================

/**
 * Загружает список товаров с сервера
 */
async function loadProducts() {
    try {
        products = await fetchJson('/parts/');
        renderProducts(currentFilter);
    } catch (error) {
        console.error('Ошибка загрузки товаров:', error);
        const grid = document.getElementById('productGrid');
        if (grid) {
            grid.innerHTML = `
                <div class="col-span-full rounded-xl border border-error/30 bg-error/10 p-10 text-center text-error">
                    <p class="font-bold">Не удалось загрузить товары</p>
                    <p class="mt-2 text-sm text-muted">Проверьте, что сервер запущен и доступен по адресу приложения.</p>
                </div>
            `;
        }
        const countEl = document.getElementById('catalogCount');
        if (countEl) countEl.textContent = 'Ошибка загрузки';
    }
}

/**
 * Загружает список заказов с сервера
 */
async function loadOrders() {
    try {
        orders = await fetchJson('/orders/');
    } catch (error) {
        console.error('Ошибка загрузки заказов:', error);
        orders = [];
    }
}

// ============================================
// ОТОБРАЖЕНИЕ ТОВАРОВ
// ============================================

function productImageUrl(product) {
    if (product.image) {
        let u = product.image.startsWith('/') ? mediaUrl(product.image) : product.image;
        if (u.startsWith('data:')) return u;
        return `${u}${u.includes('?') ? '&' : '?'}t=${Date.now()}`;
    }
    return `data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Crect fill=%22%23121212%22 width=%22400%22 height=%22300%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23888%22 font-size=%2248%22%3E—%3C/text%3E%3C/svg%3E`;
}

function renderProductCardHtml(product) {
    const productId = product.id_запчасти || product.id;
    const productName = product.название || product.name;
    const productPrice = product.цена || product.price;
    const productCategory = product.категория || product.category;
    const inStock = product.в_наличии !== undefined ? product.в_наличии : (product.inStock !== undefined ? product.inStock : product.общее_количество > 0);
    const brand = product.бренд || product.brand || '';
    const sku = product.артикул || product.sku || '';
    const condition = product.состояние || product.condition || '';
    const imageUrl = productImageUrl(product);
    const fitBadge = inStock
        ? `<span class="inline-flex items-center gap-0.5 rounded border border-success/25 bg-success/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-success">✓ В наличии</span>`
        : `<span class="inline-flex items-center gap-0.5 rounded border border-error/25 bg-error/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-error">Нет в наличии</span>`;
    return `
        <div class="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface/80 shadow-lg shadow-black/40 backdrop-blur-md transition-all hover:border-accent/45 hover:shadow-2xl hover:shadow-black/50">
            <div class="relative aspect-square cursor-pointer overflow-hidden bg-bg">
                <img src="${imageUrl}" alt="" class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                     onerror="this.onerror=null;this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Crect fill=%22%23121212%22 width=%22400%22 height=%22300%22/%3E%3C/svg%3E'">
                <div class="absolute left-3 top-3">${fitBadge}</div>
                ${brand ? `<span class="absolute right-3 top-3 rounded border border-border/40 bg-bg/80 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted backdrop-blur-sm">${brand}</span>` : ''}
            </div>
            <div class="flex flex-1 flex-col p-5 md:p-6">
                ${sku ? `<p class="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-muted">${sku}</p>` : ''}
                <h3 class="mb-4 text-base font-bold uppercase leading-snug tracking-tight text-ink">${productName}</h3>
                <div class="mb-4 grid grid-cols-2 gap-3">
                    <div>
                        <p class="mb-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Категория</p>
                        <p class="text-xs font-bold uppercase text-ink">${productCategory || '—'}</p>
                    </div>
                    <div>
                        <p class="mb-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Состояние</p>
                        <p class="text-xs font-bold uppercase text-ink">${condition || '—'}</p>
                    </div>
                </div>
                <div class="mt-auto flex items-center justify-between gap-3 border-t border-border pt-5">
                    <div>
                        <p class="mb-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-muted">Цена</p>
                        <p class="text-2xl font-black tracking-tighter text-ink">${productPrice} ₽</p>
                    </div>
                    <button type="button" class="add-to-cart flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                            title="В корзину" onclick="addToCart(${productId}, this)" ${!inStock ? 'disabled' : ''}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
                    </button>
                </div>
            </div>
        </div>`;
}

function renderProducts(filter = 'all') {
    const grid = document.getElementById('productGrid');

    if (!grid) return;

    const filtered = filter === 'all'
        ? products
        : products.filter(p => {
            const category = p.категория || p.category || '';
            return category.toLowerCase() === filter.toLowerCase();
        });

    const countEl = document.getElementById('catalogCount');
    if (countEl) {
        countEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'позиция' : filtered.length < 5 ? 'позиции' : 'позиций'}`;
    }

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full rounded-xl border border-dashed border-border py-16 text-center text-muted">Товары не найдены</div>`;
        return;
    }

    grid.innerHTML = filtered.map(renderProductCardHtml).join('');
}

/**
 * Фильтрация товаров по категории
 */
function filterProducts(category) {
    currentFilter = category;
    renderProducts(category);

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.filter || '') === category);
    });
    document.querySelectorAll('.category-card').forEach(card => {
        const f = card.dataset.filter || '';
        const on = category !== 'all' && f === category;
        card.classList.toggle('ring-2', on);
        card.classList.toggle('ring-accent', on);
        card.classList.toggle('border-accent/50', on);
    });
}

// ============================================
// РАБОТА С КОРЗИНОЙ
// ============================================

/**
 * Добавляет товар в корзину
 */
function addToCart(productId, btn) {
    const product = products.find(p => (p.id_запчасти || p.id) === productId);

    if (!product) {
        alert('Товар не найден');
        return;
    }

    const existingItem = cart.find(item => (item.id_запчасти || item.id) === productId);

    if (existingItem) {
        existingItem.quantity++;
    } else {
        cart.push({
            ...product,
            id: product.id_запчасти || product.id,
            quantity: 1
        });
    }

    updateCartCount();

    const el = btn || (typeof event !== 'undefined' && event.target ? event.target : null);
    if (el && el.classList && el.classList.contains('add-to-cart')) {
        const originalHTML = el.innerHTML;
        el.innerHTML = '✓';
        el.style.filter = 'brightness(1.2)';
        setTimeout(() => {
            el.innerHTML = originalHTML;
            el.style.filter = '';
        }, 1200);
    }
}

/**
 * Обновляет счетчик товаров в корзине
 */
function updateCartCount() {
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    const cartCountElement = document.querySelector('.cart-count');
    if (cartCountElement) {
        cartCountElement.textContent = totalItems;
    }
    localStorage.setItem('cart', JSON.stringify(cart));
}

/**
 * Открывает модальное окно корзины
 */
function openCart() {
    const modal = document.getElementById('cartModal');
    const cartContent = document.getElementById('cartContent');

    if (!modal || !cartContent) return;

    if (cart.length === 0) {
        cartContent.innerHTML = `<p class="py-12 text-center text-muted">Корзина пуста</p>`;
    } else {
        const totalPrice = cart.reduce((sum, item) => {
            const price = item.цена || item.price || 0;
            return sum + (price * item.quantity);
        }, 0);

        cartContent.innerHTML = `
            <div class="space-y-0 divide-y divide-border">
                ${cart.map(item => {
                    const itemId = item.id_запчасти || item.id;
                    const itemName = item.название || item.name;
                    const itemBrand = item.бренд || item.brand || '';
                    const itemPrice = item.цена || item.price;
                    const itemImage = item.image || `data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22%3E%3Crect fill=%22%23121212%22 width=%22400%22 height=%22300%22/%3E%3C/svg%3E`;
                    let imageUrl = itemImage.startsWith('/') ? mediaUrl(itemImage) : itemImage;
                    if (itemImage && !itemImage.startsWith('data:')) {
                        imageUrl += `${imageUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
                    }

                    return `
                        <div class="flex flex-col gap-4 py-5 sm:flex-row sm:items-start">
                            <div class="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-bg">
                                <img src="${imageUrl}" alt="" class="h-full w-full object-cover">
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="text-sm font-bold uppercase tracking-tight text-ink">${itemName}</div>
                                ${itemBrand ? `<div class="mt-1 text-sm text-muted">${itemBrand}</div>` : ''}
                                <div class="mt-2 font-bold text-ink">${itemPrice} ₽ × ${item.quantity}</div>
                                <div class="mt-3 flex flex-wrap items-center gap-2">
                                    <button type="button" class="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-ink hover:border-accent" onclick="updateQuantity(${itemId}, -1)">−</button>
                                    <span class="w-8 text-center font-bold">${item.quantity}</span>
                                    <button type="button" class="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-ink hover:border-accent" onclick="updateQuantity(${itemId}, 1)">+</button>
                                    <button type="button" class="rounded-lg border border-error/40 bg-error/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-error hover:bg-error/20" onclick="removeFromCart(${itemId})">Удалить</button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="mt-6 rounded-xl border border-border bg-bg p-5">
                <div class="flex justify-between text-sm"><span class="text-muted">Товаров</span><span>${cart.reduce((sum, item) => sum + item.quantity, 0)} шт.</span></div>
                <div class="mt-2 flex justify-between border-t border-border pt-3 text-lg font-black text-accent"><span>Итого</span><span>${totalPrice} ₽</span></div>
            </div>
            <button type="button" class="btn-primary mt-6 w-full py-4 text-center font-bold uppercase tracking-wide" onclick="openCheckout()">Оформить заказ</button>
        `;
    }

    modal.classList.add('active');
}

/**
 * Закрывает модальное окно корзины
 */
function closeCart() {
    const modal = document.getElementById('cartModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

/**
 * Обновляет количество товара в корзине
 */
function updateQuantity(productId, change) {
    const item = cart.find(item => (item.id_запчасти || item.id) === productId);
    if (item) {
        item.quantity += change;
        if (item.quantity <= 0) {
            cart = cart.filter(item => (item.id_запчасти || item.id) !== productId);
        }
        updateCartCount();
        openCart();
    }
}

/**
 * Удаляет товар из корзины
 */
function removeFromCart(productId) {
    cart = cart.filter(item => (item.id_запчасти || item.id) !== productId);
    updateCartCount();
    openCart();
}

// ============================================
// ОФОРМЛЕНИЕ ЗАКАЗА
// ============================================

/**
 * Открывает форму оформления заказа
 */
function openCheckout() {
    closeCart();
    const modal = document.getElementById('checkoutModal');
    const checkoutContent = document.getElementById('checkoutContent');

    if (!modal || !checkoutContent) return;

    const totalPrice = cart.reduce((sum, item) => {
        const price = item.цена || item.price || 0;
        return sum + (price * item.quantity);
    }, 0);
    const accountName = authUser?.full_name ? escapeHtml(authUser.full_name) : '';
    const accountEmail = authUser?.email ? escapeHtml(authUser.email) : '';
    const accountEmailHint = authUser?.email
        ? `<p class="mt-1 text-[11px] text-muted">Заказ будет привязан к аккаунту ${accountEmail}</p>`
        : '';

    checkoutContent.innerHTML = `
        <div class="mb-6 rounded-xl border border-border bg-bg p-5">
            <div class="flex justify-between text-sm text-muted"><span>Товаров</span><span>${cart.reduce((sum, item) => sum + item.quantity, 0)} шт.</span></div>
            <div class="mt-2 flex justify-between text-lg font-black text-accent"><span>Сумма</span><span>${totalPrice} ₽</span></div>
        </div>
        <form class="flex flex-col gap-4" onsubmit="submitOrder(event)">
            <div>
                <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">ФИО *</label>
                <input type="text" id="customerName" required placeholder="Иванов Иван Иванович" value="${accountName}" class="w-full rounded-lg border border-border bg-surface px-4 py-3 text-ink placeholder:text-muted focus:border-accent focus:outline-none">
            </div>
            <div>
                <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Телефон *</label>
                <input type="tel" id="customerPhone" required placeholder="+7 (999) 123-45-67" class="w-full rounded-lg border border-border bg-surface px-4 py-3 text-ink placeholder:text-muted focus:border-accent focus:outline-none">
            </div>
            <div>
                <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Email *</label>
                <input type="email" id="customerEmail" required placeholder="ivan@example.com" value="${accountEmail}" ${authUser?.email ? 'readonly' : ''} class="w-full rounded-lg border border-border bg-surface px-4 py-3 text-ink placeholder:text-muted focus:border-accent focus:outline-none ${authUser?.email ? 'cursor-not-allowed opacity-80' : ''}">
                ${accountEmailHint}
            </div>
            <div>
                <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Адрес доставки</label>
                <textarea id="customerAddress" rows="3" placeholder="Город, улица, дом, квартира" class="w-full resize-y rounded-lg border border-border bg-surface px-4 py-3 text-ink placeholder:text-muted focus:border-accent focus:outline-none"></textarea>
            </div>
            <div>
                <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-muted">Комментарий</label>
                <textarea id="orderComment" rows="3" placeholder="Дополнительные пожелания" class="w-full resize-y rounded-lg border border-border bg-surface px-4 py-3 text-ink placeholder:text-muted focus:border-accent focus:outline-none"></textarea>
            </div>
            <button type="submit" class="btn-primary w-full py-4 font-bold uppercase tracking-wide">Подтвердить заказ</button>
        </form>
    `;

    modal.classList.add('active');
}

/**
 * Закрывает форму оформления заказа
 */
function closeCheckout() {
    const modal = document.getElementById('checkoutModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

/**
 * Отправляет заказ на сервер
 */
async function submitOrder(event) {
    event.preventDefault();

    try {
        const customerEmail = authUser?.email || document.getElementById('customerEmail').value.trim();
        const customerData = {
            фио: document.getElementById('customerName').value.trim(),
            телефон: document.getElementById('customerPhone').value.trim(),
            email: customerEmail,
            адрес: document.getElementById('customerAddress').value.trim()
        };

        const client = await fetchJson('/clients/for-checkout', {
            method: 'POST',
            body: JSON.stringify(customerData),
        });

        const позиции = cart.map(item => {
            const price = item.цена || item.price || 0;
            return {
                id_запчасти: item.id_запчасти || item.id,
                количество: item.quantity,
                цена: price,
                сумма: price * item.quantity
            };
        });

        const orderData = {
            id_клиента: client.id_клиента,
            способ_оплаты: 'Онлайн',
            позиции: позиции
        };

        const order = await fetchJson('/orders/', {
            method: 'POST',
            body: JSON.stringify(orderData)
        });

        cart = [];
        updateCartCount();
        closeCheckout();

        if (authUser?.is_admin) {
            await loadOrders();
        }

        if (authUser && document.getElementById('accountModal')?.classList.contains('active')) {
            await openAccountModal();
        }

        alert(`Заказ от ${formatOrderDate(order.дата_заказа)} успешно оформлен! Сумма: ${formatMoney(order.общая_сумма)}`);

    } catch (error) {
        console.error('Ошибка создания заказа:', error);
        alert(`Не удалось оформить заказ: ${error.message}`);
    }
}

// ============================================
// РЕГИСТРАЦИЯ / ВХОД / АДМИН-ПАНЕЛЬ
// ============================================

function formatErrorDetail(data) {
    const d = data?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map(e => e.msg || JSON.stringify(e)).join('; ');
    return 'Ошибка запроса';
}

function openAuthModal(mode) {
    const m = document.getElementById('authModal');
    if (!m) return;
    m.classList.add('active');
    const err = document.getElementById('authError');
    if (err) err.textContent = '';
    document.querySelectorAll('[data-auth-panel]').forEach(el => {
        el.classList.toggle('hidden', el.dataset.authPanel !== mode);
    });
    document.querySelectorAll('[data-auth-tab]').forEach(btn => {
        const on = btn.dataset.authTab === mode;
        btn.classList.toggle('search-tab-active', on);
        btn.classList.toggle('text-accent', on);
        btn.classList.toggle('text-muted', !on);
    });
}

function closeAuthModal() {
    const m = document.getElementById('authModal');
    if (m) m.classList.remove('active');
}

function switchAuthTab(mode) {
    openAuthModal(mode);
}

async function loginFromModal() {
    const email = document.getElementById('authEmail')?.value?.trim();
    const password = document.getElementById('authPassword')?.value;
    const errorElement = document.getElementById('authError');

    if (!email || !password) {
        if (errorElement) errorElement.textContent = 'Укажите email и пароль';
        return;
    }

    try {
        const response = await fetch(`${BACKEND_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(formatErrorDetail(data) || 'Неверный email или пароль');
        }
        saveAuth(data.access_token, data.user);
        closeAuthModal();
        if (errorElement) errorElement.textContent = '';
        if (data.user?.is_admin) {
            await loadOrders();
            const panel = document.getElementById('adminPanel');
            if (panel) {
                panel.classList.remove('hidden');
                panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    } catch (error) {
        console.error(error);
        if (errorElement) errorElement.textContent = error.message || 'Ошибка входа';
    }
}

async function registerFromModal() {
    const email = document.getElementById('regEmail')?.value?.trim();
    const password = document.getElementById('regPassword')?.value;
    const fullName = document.getElementById('regFullName')?.value?.trim();
    const errorElement = document.getElementById('authError');

    if (!email || !password) {
        if (errorElement) errorElement.textContent = 'Укажите email и пароль';
        return;
    }
    if (password.length < 8) {
        if (errorElement) errorElement.textContent = 'Пароль не короче 8 символов';
        return;
    }

    try {
        const response = await fetch(`${BACKEND_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, full_name: fullName || null }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(formatErrorDetail(data) || 'Не удалось зарегистрироваться');
        }
        if (errorElement) errorElement.textContent = '';
        document.getElementById('authEmail').value = email;
        document.getElementById('authPassword').value = password;
        switchAuthTab('login');
        if (errorElement) errorElement.textContent = 'Аккаунт создан. Войдите.';
    } catch (error) {
        console.error(error);
        if (errorElement) errorElement.textContent = error.message || 'Ошибка регистрации';
    }
}

function logoutUser() {
    closeAccountModal();
    clearAuth();
    const panel = document.getElementById('adminPanel');
    if (panel) {
        panel.classList.add('hidden');
    }
    const adminContent = document.getElementById('adminContent');
    if (adminContent) {
        adminContent.innerHTML = '';
    }
}

/**
 * Управление товарами (админ)
 */
async function manageProducts() {
    try {
        const parts = await fetchJson('/parts/');
        const adminContent = document.getElementById('adminContent');

        if (!adminContent) return;

        adminContent.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h4 style="color: var(--color-ink); margin: 0;">Управление товарами</h4>
                <button class="admin-btn" onclick="showAddProductForm()" style="background: #10b981;">
                    ➕ Добавить товар
                </button>
            </div>
            <table class="products-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Название</th>
                        <th>Артикул</th>
                        <th>Категория</th>
                        <th>Цена</th>
                        <th>Наличие</th>
                        <th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${parts.map(product => {
                        const inStock = product.в_наличии !== undefined ? product.в_наличии : (product.общее_количество > 0);
                        return `
                            <tr>
                                <td>${product.id_запчасти}</td>
                                <td>${product.название}</td>
                                <td>${product.артикул || '-'}</td>
                                <td>${product.категория || '-'}</td>
                                <td>${product.цена || 0} ₽</td>
                                <td>
                                    <button class="status-toggle ${inStock ? 'status-in-stock' : 'status-out-of-stock'}"
                                            onclick="toggleStock(${product.id_запчасти})">
                                        ${inStock ? 'В наличии' : 'Нет в наличии'}
                                    </button>
                                </td>
                                <td>
                                    <button class="admin-btn" onclick="editProduct(${product.id_запчасти})" style="margin-right: 5px;">
                                        ✏️ Редактировать
                                    </button>
                                    <button class="admin-btn" onclick="deleteProduct(${product.id_запчасти})"
                                            style="background: #ef4444;">
                                        🗑️ Удалить
                                    </button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Ошибка загрузки товаров:', error);
        const adminContent = document.getElementById('adminContent');
        if (adminContent) {
            adminContent.innerHTML = '<p style="color: var(--color-muted);">Ошибка загрузки товаров</p>';
        }
    }
}

/**
 * Показывает форму добавления товара
 */
function showAddProductForm() {
    const modal = createProductModal();
    document.body.appendChild(modal);
    modal.classList.add('active');
}

/**
 * Создает модальное окно для добавления/редактирования товара
 */
function createProductModal(product = null) {
    const isEdit = product !== null;
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'productModal';

    const imageUrl = product && product.image
        ? (product.image.startsWith('/') ? mediaUrl(product.image) : product.image)
        : null;

    modal.innerHTML = `
        <div class="modal-content glass-panel" style="max-width: 600px;">
            <div class="modal-header">
                <h2 class="modal-title">${isEdit ? 'Редактировать товар' : 'Добавить товар'}</h2>
                <button class="close-btn" onclick="closeProductModal()">×</button>
            </div>
            <form class="checkout-form" onsubmit="saveProduct(event, ${isEdit ? product.id_запчасти : 'null'})">
                <div class="form-group">
                    <label>Название *</label>
                    <input type="text" id="productName" required
                           value="${product ? (product.название || '') : ''}"
                           placeholder="Тормозные колодки">
                </div>
                <div class="form-group">
                    <label>Артикул</label>
                    <input type="text" id="productArticle"
                           value="${product ? (product.артикул || '') : ''}"
                           placeholder="BR-12345">
                </div>
                <div class="form-group">
                    <label>Категория</label>
                    <select id="productCategory" style="padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.95rem; width: 100%;">
                        <option value="">Выберите категорию</option>
                        <option value="brakes" ${product && product.категория === 'brakes' ? 'selected' : ''}>Тормоза</option>
                        <option value="engine" ${product && product.категория === 'engine' ? 'selected' : ''}>Двигатель</option>
                        <option value="suspension" ${product && product.категория === 'suspension' ? 'selected' : ''}>Подвеска</option>
                        <option value="electrical" ${product && product.категория === 'electrical' ? 'selected' : ''}>Аккумуляторы</option>
                        <option value="filters" ${product && product.категория === 'filters' ? 'selected' : ''}>Масла</option>
                        <option value="lighting" ${product && product.категория === 'lighting' ? 'selected' : ''}>Освещение</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Состояние</label>
                    <select id="productCondition" style="padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.95rem; width: 100%;">
                        <option value="">Выберите состояние</option>
                        <option value="новый" ${product && product.состояние === 'новый' ? 'selected' : ''}>Новый</option>
                        <option value="б/у" ${product && product.состояние === 'б/у' ? 'selected' : ''}>Б/У</option>
                        <option value="восстановленный" ${product && product.состояние === 'восстановленный' ? 'selected' : ''}>Восстановленный</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Цена (₽) *</label>
                    <input type="number" id="productPrice" required min="0" step="0.01"
                           value="${product ? (product.цена || '') : ''}"
                           placeholder="2500.00">
                </div>
                <div class="form-group">
                    <label>Описание</label>
                    <textarea id="productDescription" rows="4"
                              placeholder="Подробное описание товара">${product ? (product.описание || '') : ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Изображение</label>
                    <input type="file" id="productImage" accept="image/*" style="padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.95rem; width: 100%;">
                    ${imageUrl ? `
                        <div style="margin-top: 10px;">
                            <p style="font-size: 0.85rem; color: #64748b; margin-bottom: 5px;">Текущее изображение:</p>
                            <img src="${imageUrl}" alt="Текущее изображение" style="max-width: 200px; max-height: 200px; border-radius: 8px; border: 1px solid #e2e8f0;">
                        </div>
                    ` : ''}
                </div>
                <div style="display: flex; gap: 10px;">
                    <button type="submit" class="checkout-btn" style="flex: 1; background: #10b981;">
                        ${isEdit ? '💾 Сохранить изменения' : '➕ Добавить товар'}
                    </button>
                    <button type="button" class="checkout-btn" onclick="closeProductModal()"
                            style="flex: 1; background: #64748b;">
                        Отмена
                    </button>
                </div>
            </form>
        </div>
    `;

    return modal;
}

/**
 * Закрывает модальное окно товара
 */
function closeProductModal() {
    const modal = document.getElementById('productModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    }
}

/**
 * Сохраняет товар (создает или обновляет) с загрузкой изображения
 */
async function saveProduct(event, productId) {
    event.preventDefault();

    try {
        const productData = {
            название: document.getElementById('productName').value,
            артикул: document.getElementById('productArticle').value || null,
            категория: document.getElementById('productCategory').value || null,
            состояние: document.getElementById('productCondition').value || null,
            цена: parseFloat(document.getElementById('productPrice').value),
            описание: document.getElementById('productDescription').value || null
        };

        let savedProduct;

        if (productId) {
            savedProduct = await fetchJson(`/parts/${productId}`, {
                method: 'PUT',
                body: JSON.stringify(productData)
            });
            alert('✅ Товар успешно обновлен!');
        } else {
            savedProduct = await fetchJson('/parts/', {
                method: 'POST',
                body: JSON.stringify(productData)
            });
            alert('✅ Товар успешно добавлен!');
        }

        // Загружаем изображение если выбрано
        const imageInput = document.getElementById('productImage');
        if (imageInput && imageInput.files && imageInput.files[0]) {
            const formData = new FormData();
            formData.append('file', imageInput.files[0]);

            const partId = productId || savedProduct.id_запчасти;

            const response = await fetch(`${BACKEND_BASE}/parts/${partId}/image`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Ошибка загрузки изображения:', errorText);
                throw new Error('Ошибка загрузки изображения');
            }
            
            const uploadResult = await response.json();
            console.log('Изображение загружено:', uploadResult);
            
            // Небольшая задержка для того, чтобы файл успел сохраниться на диск
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        closeProductModal();

        // Обновляем список товаров после загрузки изображения
        await loadProducts();
        await manageProducts();

    } catch (error) {
        console.error('Ошибка сохранения товара:', error);
        alert(`❌ Ошибка: ${error.message}`);
    }
}

/**
 * Редактирование товара
 */
async function editProduct(productId) {
    try {
        const product = await fetchJson(`/parts/${productId}`);
        const modal = createProductModal(product);
        document.body.appendChild(modal);
        modal.classList.add('active');
    } catch (error) {
        console.error('Ошибка загрузки товара:', error);
        alert('Не удалось загрузить данные товара');
    }
}

/**
 * Удаление товара
 */
async function deleteProduct(productId) {
    const product = await fetchJson(`/parts/${productId}`);
    const productName = product.название || 'товар';

    if (!confirm(`Вы уверены, что хотите удалить товар "${productName}"?\n\nЭто действие нельзя отменить!`)) {
        return;
    }

    try {
        await fetchJson(`/parts/${productId}`, {
            method: 'DELETE'
        });

        alert('✅ Товар успешно удален!');

        await loadProducts();
        await manageProducts();

    } catch (error) {
        console.error('Ошибка удаления товара:', error);
        alert(`❌ Ошибка удаления: ${error.message}`);
    }
}

/**
 * Просмотр заказов (админ)
 */
async function viewOrders() {
    try {
        await loadOrders();
        const adminContent = document.getElementById('adminContent');

        if (!adminContent) return;

        adminContent.innerHTML = `
            <h4 style="color: var(--color-ink); margin-bottom: 15px;">Заказы (${orders.length})</h4>
            ${orders.length === 0 ?
                '<p style="color: var(--color-muted);">Нет заказов</p>' :
                orders.map(order => {
                    const orderDate = new Date(order.дата_заказа).toLocaleString('ru-RU');
                    const statusColors = {
                        'новый': '#3b82f6',
                        'в обработке': '#f59e0b',
                        'отправлен': '#8b5cf6',
                        'доставлен': '#10b981',
                        'отменен': '#ef4444'
                    };
                    const statusColor = statusColors[order.статус?.toLowerCase()] || '#64748b';
                    return `
                        <div class="order-item order-card-admin">
                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                                <div style="flex: 1; cursor: pointer;" onclick="showOrderDetails(${order.id_заказа})">
                                    <div style="font-weight: 800; color: var(--color-ink); font-size: 1.05rem; margin-bottom: 5px;">
                                        Заказ №${order.id_заказа}
                                    </div>
                                    <div style="color: var(--color-muted); font-size: 0.9rem;">${orderDate}</div>
                                </div>
                                <div style="display: flex; gap: 10px; align-items: center;">
                                    <div style="background: ${statusColor}; color: white; padding: 4px 12px; border-radius: 6px; font-size: 0.85rem; font-weight: 500;">
                                        ${order.статус || 'новый'}
                                    </div>
                                    <button class="admin-btn" onclick="event.stopPropagation(); deleteOrder(${order.id_заказа})" 
                                            style="background: #ef4444; padding: 6px 12px; font-size: 0.85rem;">
                                        🗑️ Удалить
                                    </button>
                                </div>
                            </div>
                            <div style="cursor: pointer;" onclick="showOrderDetails(${order.id_заказа})">
                                <div style="color: var(--color-muted); font-size: 0.9rem; margin-bottom: 5px;">
                                    Клиент ID: ${order.id_клиента}
                                </div>
                                <div style="color: var(--color-muted); font-size: 0.9rem; margin-bottom: 5px;">
                                    Товаров: ${order.позиции?.length || 0} шт.
                                </div>
                                <div style="color: var(--color-ink); font-weight: 700; font-size: 1rem;">
                                    Сумма: ${order.общая_сумма || 0} ₽
                                </div>
                                <div style="margin-top: 10px; color: var(--color-accent); font-size: 0.85rem;">
                                    Нажмите для просмотра деталей
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')
            }
        `;
        
        // Добавляем стили для hover эффекта
        const style = document.createElement('style');
        style.textContent = `
            .order-item.order-card-admin:hover {
                border-color: rgba(255, 77, 0, 0.45) !important;
            }
        `;
        if (!document.getElementById('order-item-styles')) {
            style.id = 'order-item-styles';
            document.head.appendChild(style);
        }
    } catch (error) {
        console.error('Ошибка загрузки заказов:', error);
        const adminContent = document.getElementById('adminContent');
        if (adminContent) {
            adminContent.innerHTML = '<p style="color: var(--color-muted);">Ошибка загрузки заказов</p>';
        }
    }
}

/**
 * Показывает детали заказа в модальном окне
 */
async function showOrderDetails(orderId) {
    try {
        const order = await fetchJson(`/orders/${orderId}`);
        const client = await fetchJson(`/clients/${order.id_клиента}`);
        
        // Загружаем информацию о товарах в позициях
        const positionsWithDetails = await Promise.all(
            (order.позиции || []).map(async (position) => {
                try {
                    const part = await fetchJson(`/parts/${position.id_запчасти}`);
                    return {
                        ...position,
                        название: part.название,
                        артикул: part.артикул,
                        категория: part.категория
                    };
                } catch (error) {
                    console.error(`Ошибка загрузки товара ${position.id_запчасти}:`, error);
                    return {
                        ...position,
                        название: `Товар #${position.id_запчасти}`,
                        артикул: '-',
                        категория: '-'
                    };
                }
            })
        );

        const orderDate = new Date(order.дата_заказа).toLocaleString('ru-RU');
        const statusColors = {
            'новый': '#3b82f6',
            'в обработке': '#f59e0b',
            'отправлен': '#8b5cf6',
            'доставлен': '#10b981',
            'отменен': '#ef4444'
        };
        const statusColor = statusColors[order.статус?.toLowerCase()] || '#64748b';

        // Создаем модальное окно
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'orderDetailsModal';
        modal.innerHTML = `
            <div class="modal-content glass-panel" style="max-width: 800px;">
                <div class="modal-header">
                    <h2 class="modal-title">Детали заказа №${order.id_заказа}</h2>
                    <button class="close-btn" onclick="closeOrderDetails()">×</button>
                </div>
                <div style="overflow-y: auto; max-height: 70vh;">
                    <!-- Информация о заказе -->
                    <div style="background: var(--color-bg); border: 1px solid var(--color-border); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <h3 style="color: var(--color-ink); margin-bottom: 15px; font-size: 1.2rem;">Информация о заказе</h3>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div>
                                <div style="color: var(--color-muted); font-size: 0.85rem; margin-bottom: 5px;">Номер заказа</div>
                                <div style="color: var(--color-ink); font-weight: 600; font-size: 1.1rem;">№${order.id_заказа}</div>
                            </div>
                            <div>
                                <div style="color: var(--color-muted); font-size: 0.85rem; margin-bottom: 5px;">Дата заказа</div>
                                <div style="color: var(--color-ink); font-weight: 500;">${orderDate}</div>
                            </div>
                            <div>
                                <div style="color: var(--color-muted); font-size: 0.85rem; margin-bottom: 5px;">Статус</div>
                                <div style="background: ${statusColor}; color: white; padding: 6px 12px; border-radius: 6px; display: inline-block; font-weight: 500;">
                                    ${order.статус || 'новый'}
                                </div>
                            </div>
                            <div>
                                <div style="color: var(--color-muted); font-size: 0.85rem; margin-bottom: 5px;">Способ оплаты</div>
                                <div style="color: var(--color-ink); font-weight: 500;">${order.способ_оплаты || 'Не указан'}</div>
                            </div>
                            <div style="grid-column: 1 / -1;">
                                <div style="color: var(--color-muted); font-size: 0.85rem; margin-bottom: 5px;">Общая сумма</div>
                                <div style="color: var(--color-accent); font-weight: 700; font-size: 1.5rem;">${order.общая_сумма || 0} ₽</div>
                            </div>
                        </div>
                    </div>

                    <!-- Информация о клиенте -->
                    <div style="background: var(--color-bg); border: 1px solid var(--color-border); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <h3 style="color: var(--color-ink); margin-bottom: 15px; font-size: 1.2rem;">Информация о клиенте</h3>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div>
                                <div style="color: var(--color-muted); font-size: 0.85rem; margin-bottom: 5px;">ФИО</div>
                                <div style="color: var(--color-ink); font-weight: 500;">${client.фио || '-'}</div>
                            </div>
                            <div>
                                <div style="color: var(--color-muted); font-size: 0.85rem; margin-bottom: 5px;">Телефон</div>
                                <div style="color: var(--color-ink); font-weight: 500;">${client.телефон || '-'}</div>
                            </div>
                            <div>
                                <div style="color: var(--color-muted); font-size: 0.85rem; margin-bottom: 5px;">Email</div>
                                <div style="color: var(--color-ink); font-weight: 500;">${client.email || '-'}</div>
                            </div>
                            <div>
                                <div style="color: var(--color-muted); font-size: 0.85rem; margin-bottom: 5px;">Адрес</div>
                                <div style="color: var(--color-ink); font-weight: 500;">${client.адрес || '-'}</div>
                            </div>
                        </div>
                    </div>

                    <!-- Позиции заказа -->
                    <div style="margin-bottom: 20px;">
                        <h3 style="color: var(--color-ink); margin-bottom: 15px; font-size: 1.2rem;">Товары в заказе (${positionsWithDetails.length})</h3>
                        <div style="overflow-x: auto;">
                            <table class="products-table" style="width: 100%;">
                                <thead>
                                    <tr>
                                        <th>Товар</th>
                                        <th>Артикул</th>
                                        <th>Категория</th>
                                        <th>Количество</th>
                                        <th>Цена за шт.</th>
                                        <th>Сумма</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${positionsWithDetails.map(pos => `
                                        <tr>
                                            <td style="font-weight: 500;">${pos.название || '-'}</td>
                                            <td>${pos.артикул || '-'}</td>
                                            <td>${pos.категория || '-'}</td>
                                            <td>${pos.количество}</td>
                                            <td>${pos.цена} ₽</td>
                                            <td style="font-weight: 600;">${pos.сумма} ₽</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Действия -->
                    <div style="display: flex; gap: 10px; margin-top: 20px;">
                        <button class="admin-btn" onclick="changeOrderStatus(${order.id_заказа})" style="flex: 1;">
                            🔄 Изменить статус
                        </button>
                        <button class="admin-btn" onclick="deleteOrderFromModal(${order.id_заказа})" style="flex: 1; background: #ef4444;">
                            🗑️ Удалить заказ
                        </button>
                        <button class="admin-btn admin-btn-ghost" onclick="closeOrderDetails()" style="flex: 1;">
                            Закрыть
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('active'), 10);
    } catch (error) {
        console.error('Ошибка загрузки деталей заказа:', error);
        alert(`Не удалось загрузить детали заказа: ${error.message}`);
    }
}

/**
 * Закрывает модальное окно деталей заказа
 */
function closeOrderDetails() {
    const modal = document.getElementById('orderDetailsModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    }
}

/**
 * Удаляет заказ из списка
 */
async function deleteOrder(orderId) {
    try {
        const order = await fetchJson(`/orders/${orderId}`);
        const orderDate = new Date(order.дата_заказа).toLocaleString('ru-RU');
        const confirmMessage = `Вы уверены, что хотите удалить заказ №${orderId}?\n\nДата: ${orderDate}\nСумма: ${order.общая_сумма || 0} ₽\n\nЭто действие нельзя отменить!`;
        
        if (!confirm(confirmMessage)) {
            return;
        }

        await fetchJson(`/orders/${orderId}`, {
            method: 'DELETE'
        });

        alert('✅ Заказ успешно удален!');
        await viewOrders();

    } catch (error) {
        console.error('Ошибка удаления заказа:', error);
        alert(`❌ Ошибка удаления заказа: ${error.message}`);
    }
}

/**
 * Удаляет заказ из модального окна
 */
async function deleteOrderFromModal(orderId) {
    try {
        const order = await fetchJson(`/orders/${orderId}`);
        const confirmMessage = `Вы уверены, что хотите удалить заказ №${orderId}?\n\nСумма: ${order.общая_сумма || 0} ₽\n\nЭто действие нельзя отменить!`;
        
        if (!confirm(confirmMessage)) {
            return;
        }

        await fetchJson(`/orders/${orderId}`, {
            method: 'DELETE'
        });

        closeOrderDetails();
        alert('✅ Заказ успешно удален!');
        await viewOrders();

    } catch (error) {
        console.error('Ошибка удаления заказа:', error);
        alert(`❌ Ошибка удаления заказа: ${error.message}`);
    }
}

/**
 * Управление остатками (админ) - ИСПРАВЛЕННАЯ ВЕРСИЯ
 */
async function manageStock() {
    try {
        // Получаем все остатки
        const allStocks = await fetchJson('/admin/stock/all');
        const lowStocks = await fetchJson('/admin/stock/low?threshold=5');
        const warehouses = await fetchJson('/admin/warehouses');
        const parts = await fetchJson('/parts/');

        const adminContent = document.getElementById('adminContent');
        if (!adminContent) return;

        adminContent.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h4 style="color: var(--color-ink); margin: 0;">Управление остатками</h4>
                <button class="admin-btn" onclick="showAddStockForm()" style="background: #10b981;">
                    ➕ Добавить остаток
                </button>
            </div>

            ${lowStocks.length > 0 ? `
                <div style="background: #fee2e2; color: #991b1b; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <strong>⚠️ Товары с низким остатком (${lowStocks.length}):</strong>
                </div>
            ` : ''}

            <table class="products-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Товар</th>
                        <th>Артикул</th>
                        <th>Склад</th>
                        <th>Количество</th>
                        <th>Код места</th>
                        <th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${allStocks.length === 0 ? `
                        <tr>
                            <td colspan="7" style="text-align: center; padding: 20px; color: #64748b;">
                                Нет остатков. Добавьте остатки для товаров.
                            </td>
                        </tr>
                    ` : allStocks.map(stock => `
                        <tr>
                            <td>${stock.id_остатка}</td>
                            <td>${stock.запчасть}</td>
                            <td>${stock.артикул || '-'}</td>
                            <td>${stock.склад}</td>
                            <td>
                                <input type="number"
                                       id="stock_qty_${stock.id_остатка}"
                                       value="${stock.количество}"
                                       min="0"
                                       style="width: 80px; padding: 5px; border: 1px solid #e2e8f0; border-radius: 4px;">
                            </td>
                            <td>
                                <input type="text"
                                       id="stock_place_${stock.id_остатка}"
                                       value="${stock.код_места || ''}"
                                       placeholder="A-1-2"
                                       style="width: 100px; padding: 5px; border: 1px solid #e2e8f0; border-radius: 4px;">
                            </td>
                            <td>
                                <button class="admin-btn" onclick="updateStock(${stock.id_остатка})" style="background: #10b981; margin-right: 5px; padding: 6px 12px; font-size: 0.85rem;">
                                    💾 Сохранить
                                </button>
                                <button class="admin-btn" onclick="deleteStock(${stock.id_остатка})" style="background: #ef4444; padding: 6px 12px; font-size: 0.85rem;">
                                    🗑️ Удалить
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Ошибка загрузки остатков:', error);
        const adminContent = document.getElementById('adminContent');
        if (adminContent) {
            adminContent.innerHTML = `
                <p class="text-muted">Ошибка загрузки остатков: ${error.message}</p>
                <button type="button" class="admin-btn mt-3" onclick="manageStock()">Повторить</button>
            `;
        }
    }
}

/**
 * Показывает форму добавления остатка
 */
async function showAddStockForm() {
    try {
        const parts = await fetchJson('/parts/');
        const warehouses = await fetchJson('/admin/warehouses');

        if (warehouses.length === 0) {
            alert('⚠️ Нет складов в системе. Сначала создайте склад через базу данных.');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'stockModal';

        modal.innerHTML = `
            <div class="modal-content glass-panel" style="max-width: 500px;">
                <div class="modal-header">
                    <h2 class="modal-title">Добавить остаток</h2>
                    <button class="close-btn" onclick="closeStockModal()">×</button>
                </div>
                <form class="checkout-form" onsubmit="createStock(event)">
                    <div class="form-group">
                        <label>Товар *</label>
                        <select id="stockPartId" required style="padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.95rem; width: 100%;">
                            <option value="">Выберите товар</option>
                            ${parts.map(p => `<option value="${p.id_запчасти}">${p.название} ${p.артикул ? `(${p.артикул})` : ''}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Склад *</label>
                        <select id="stockWarehouseId" required style="padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.95rem; width: 100%;">
                            <option value="">Выберите склад</option>
                            ${warehouses.map(w => `<option value="${w.id_склада}">${w.название_склада}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Количество *</label>
                        <input type="number" id="stockQuantity" required min="0" value="0">
                    </div>
                    <div class="form-group">
                        <label>Код места</label>
                        <input type="text" id="stockPlace" placeholder="A-1-2">
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button type="submit" class="checkout-btn" style="flex: 1; background: #10b981;">
                            ➕ Добавить
                        </button>
                        <button type="button" class="checkout-btn" onclick="closeStockModal()" style="flex: 1; background: #64748b;">
                            Отмена
                        </button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);
        modal.classList.add('active');
    } catch (error) {
        console.error('Ошибка:', error);
        alert(`Не удалось загрузить данные: ${error.message}`);
    }
}

/**
 * Создает остаток - ИСПРАВЛЕННАЯ ВЕРСИЯ
 */
async function createStock(event) {
    event.preventDefault();

    try {
        const stockData = {
            id_запчасти: parseInt(document.getElementById('stockPartId').value),
            id_склада: parseInt(document.getElementById('stockWarehouseId').value),
            количество: parseInt(document.getElementById('stockQuantity').value),
            код_места: document.getElementById('stockPlace').value || null
        };

        await fetchJson('/admin/stock', {
            method: 'POST',
            body: JSON.stringify(stockData)
        });

        alert('✅ Остаток успешно добавлен!');
        closeStockModal();
        await manageStock();
        await loadProducts();

    } catch (error) {
        console.error('Ошибка создания остатка:', error);
        alert(`❌ Ошибка: ${error.message}`);
    }
}

/**
 * Обновляет остаток - ИСПРАВЛЕННАЯ ВЕРСИЯ
 */
async function updateStock(stockId) {
    try {
        const quantity = parseInt(document.getElementById(`stock_qty_${stockId}`).value);
        const place = document.getElementById(`stock_place_${stockId}`).value || null;

        const url = `/admin/stock/${stockId}?quantity=${quantity}${place ? `&код_места=${encodeURIComponent(place)}` : ''}`;

        await fetchJson(url, {
            method: 'PUT'
        });

        alert('✅ Остаток обновлен!');
        await manageStock();
        await loadProducts();

    } catch (error) {
        console.error('Ошибка обновления остатка:', error);
        alert(`❌ Ошибка: ${error.message}`);
    }
}

/**
 * Удаляет остаток
 */
async function deleteStock(stockId) {
    if (!confirm('Вы уверены, что хотите удалить этот остаток?')) {
        return;
    }

    try {
        await fetchJson(`/admin/stock/${stockId}`, {
            method: 'DELETE'
        });

        alert('✅ Остаток удален!');
        await manageStock();
        await loadProducts();

    } catch (error) {
        console.error('Ошибка удаления остатка:', error);
        alert(`❌ Ошибка: ${error.message}`);
    }
}

/**
 * Закрывает модальное окно остатка
 */
function closeStockModal() {
    const modal = document.getElementById('stockModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    }
}

/**
 * Переключение наличия товара
 */
async function toggleStock(productId) {
    try {
        const product = await fetchJson(`/parts/${productId}`);
        const currentStock = product.в_наличии !== undefined ? product.в_наличии : (product.общее_количество > 0);

        alert('Для изменения остатков используйте раздел "Управление остатками"');

        await loadProducts();
        await manageProducts();
    } catch (error) {
        console.error('Ошибка:', error);
    }
}

/**
 * Изменение статуса заказа
 */
async function changeOrderStatus(orderId) {
    const statuses = ['новый', 'в обработке', 'отправлен', 'доставлен', 'отменен'];

    try {
        const order = await fetchJson(`/orders/${orderId}`);
        const currentStatus = order.статус || 'новый';
        const currentIndex = statuses.indexOf(currentStatus.toLowerCase());
        const nextIndex = (currentIndex + 1) % statuses.length;
        const newStatus = statuses[nextIndex];

        await fetchJson(`/orders/${orderId}/status?new_status=${newStatus}`, {
            method: 'PATCH'
        });

        // Обновляем список заказов
        await viewOrders();
        
        // Если модальное окно открыто, обновляем его
        const modal = document.getElementById('orderDetailsModal');
        if (modal && modal.classList.contains('active')) {
            closeOrderDetails();
            setTimeout(() => showOrderDetails(orderId), 350);
        }

    } catch (error) {
        console.error('Ошибка изменения статуса:', error);
        alert('Не удалось изменить статус заказа');
    }
}

// ============================================
// UI: табы поиска в шапке героя
// ============================================

function initHeroSearchTabs() {
    const tablist = document.querySelector('[role="tablist"]');
    if (!tablist) return;

    tablist.querySelectorAll('.search-tab[data-tab]').forEach(tab => {
        tab.addEventListener('click', function handleTab() {
            const t = this.dataset.tab;
            if (t === 'cat') return;
            tablist.querySelectorAll('.search-tab[data-tab]').forEach(x => x.classList.remove('search-tab-active'));
            this.classList.add('search-tab-active');
            const inp = document.getElementById('searchInput');
            if (inp) {
                inp.placeholder = 'Поиск по названию, бренду, артикулу или категории…';
            }
        });
    });
}

// ============================================
// ПОИСК
// ============================================

/**
 * Инициализация поиска
 */
function initSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    let searchTimeout;

    searchInput.addEventListener('input', function(e) {
        clearTimeout(searchTimeout);
        const query = e.target.value.toLowerCase().trim();

        searchTimeout = setTimeout(() => {
            if (query === '') {
                renderProducts(currentFilter);
                return;
            }

            const filtered = products.filter(p => {
                const name = (p.название || p.name || '').toLowerCase();
                const brand = (p.бренд || p.brand || '').toLowerCase();
                const category = (p.категория || p.category || '').toLowerCase();
                const article = (p.артикул || p.article || '').toLowerCase();

                return name.includes(query) ||
                       brand.includes(query) ||
                       category.includes(query) ||
                       article.includes(query);
            });

            const grid = document.getElementById('productGrid');
            if (!grid) return;

            const countElSearch = document.getElementById('catalogCount');
            if (countElSearch) {
                countElSearch.textContent = `${filtered.length} ${filtered.length === 1 ? 'позиция' : filtered.length < 5 ? 'позиции' : 'позиций'}`;
            }

            if (filtered.length === 0) {
                grid.innerHTML = `<div class="col-span-full rounded-xl border border-dashed border-border py-16 text-center text-muted">Ничего не найдено</div>`;
            } else {
                grid.innerHTML = filtered.map(renderProductCardHtml).join('');
            }
        }, 300);
    });
}

// ============================================
// ВОССТАНОВЛЕНИЕ ДАННЫХ ИЗ LOCALSTORAGE
// ============================================

/**
 * Загружает корзину из localStorage
 */
function loadCartFromStorage() {
    try {
        const savedCart = localStorage.getItem('cart');
        if (savedCart) {
            cart = JSON.parse(savedCart);
            updateCartCount();
        }
    } catch (error) {
        console.error('Ошибка загрузки корзины:', error);
        cart = [];
    }
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ
// ============================================

/**
 * Закрытие модалок по клику на затемнённый фон
 */
function initModalDismiss() {
    document.querySelectorAll('.modal').forEach((modal) => {
        if (modal.dataset.dismissBound === 'true') return;
        modal.dataset.dismissBound = 'true';
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
}

/**
 * Кнопки корзины и профиля в шапке (не зависят от inline onclick)
 */
function initHeaderActions() {
    const cartBtn = document.getElementById('headerCartBtn');
    if (cartBtn && cartBtn.dataset.bound !== 'true') {
        cartBtn.dataset.bound = 'true';
        cartBtn.addEventListener('click', (event) => {
            event.preventDefault();
            openCart();
        });
    }

    const profileBtn = document.getElementById('headerProfileBtn');
    if (profileBtn && profileBtn.dataset.bound !== 'true') {
        profileBtn.dataset.bound = 'true';
        profileBtn.addEventListener('click', (event) => {
            event.preventDefault();
            handleProfileClick();
        });
    }

    document.querySelectorAll('[data-action="open-profile"]').forEach((btn) => {
        if (btn.dataset.bound === 'true') return;
        btn.dataset.bound = 'true';
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            handleProfileClick();
            document.getElementById('mobileNav')?.classList.add('hidden');
        });
    });
}

/**
 * Инициализация приложения
 */
export async function init() {
    loadCartFromStorage();
    await refreshSession();
    updateAuthUI();
    initHeaderActions();
    initModalDismiss();
    initHeroSearchTabs();
    initCategoryCardImages();
    await loadProducts();
    initSearch();

    if (authUser?.is_admin) {
        await loadOrders();
    }
}

Object.assign(window, {
    handleProfileClick,
    openAccountModal,
    closeAccountModal,
    openAuthModal,
    closeAuthModal,
    switchAuthTab,
    loginFromModal,
    registerFromModal,
    logoutUser,
    filterProducts,
    openCart,
    closeCart,
    openCheckout,
    closeCheckout,
    submitOrder,
    manageProducts,
    viewOrders,
    manageStock,
    addToCart,
    updateQuantity,
    removeFromCart,
    showAddProductForm,
    closeProductModal,
    saveProduct,
    editProduct,
    deleteProduct,
    showOrderDetails,
    closeOrderDetails,
    deleteOrder,
    deleteOrderFromModal,
    changeOrderStatus,
    showAddStockForm,
    createStock,
    closeStockModal,
    updateStock,
    deleteStock,
    toggleStock,
});
